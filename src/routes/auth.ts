import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { getJwtSecret, isSetupCompleted } from '../db';
import { generateRealityKeyPair, generateToken, generateUUID } from '../keys';
import { loginGuardKeys, getLockRemaining, recordLoginFailure, clearLoginFailures } from '../login-guard';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from '../lib/crypto';
import { authMiddleware } from '../middleware/auth';
import type { AppBindings, AppVariables, JwtUser } from '../types';

export const authRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

authRoute.get('/api/v1/system/setup/status', async (c) => {
  const initialized = await isSetupCompleted(c.env.DB);
  return c.json({ is_initialized: initialized, version: '1.15.3' });
});

authRoute.post('/api/v1/system/setup', async (c) => {
  if (await isSetupCompleted(c.env.DB)) {
    return c.json({ error: '系统已完成初始化引导，不可重复提交' }, 400);
  }

  const body = await c.req.json();
  const username = (body.username || 'admin').trim();
  const password = body.password || '';
  const confirmPassword = body.confirm_password || '';

  if (!username) return c.json({ error: '管理员用户名不能为空' }, 400);
  if (password.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);
  if (password !== confirmPassword) return c.json({ error: '两次输入的密码不一致' }, 400);

  const hashed = await hashPassword(password);
  const subToken = generateToken(32);
  const uuid = generateUUID();
  const proxyPassword = generateToken(16);

  // Create superadmin user (ID: 1, role: 'admin')
  const res = await c.env.DB.prepare(`
    INSERT INTO users (username, password_hash, role, uuid, proxy_password, sub_token, status)
    VALUES (?, ?, 'admin', ?, ?, ?, 1)
  `).bind(username, hashed, uuid, proxyPassword, subToken).run();

  const adminId = res.meta.last_row_id || 1;

  // Create default global inbound templates (VLESS Reality & Hysteria 2)
  const keys = generateRealityKeyPair();
  const shortId = generateToken(16);
  await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      owner_id, name, protocol, reality_dest, reality_server_name, reality_private_key, reality_public_key, reality_short_id, is_default
    ) VALUES (NULL, '默认 VLESS Reality', 'vless', 'www.amazon.com:443', 'www.amazon.com', ?, ?, ?, 1)
  `).bind(keys.privateKey, keys.publicKey, shortId).run();

  await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      owner_id, name, protocol, hy2_up_mbps, hy2_down_mbps, hy2_masquerade, is_default
    ) VALUES (NULL, '默认 Hysteria 2', 'hysteria2', 100, 100, 'https://bing.com', 1)
  `).run();

  // Mark setup completed
  await c.env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('setup_completed', 'true')").run();

  const secret = await getJwtSecret(c.env.DB);
  const token = await sign({ userId: adminId, username, role: 'admin', exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, 'HS256');

  return c.json({
    success: true,
    token,
    user: { id: adminId, username, role: 'admin' }
  });
});

authRoute.post('/api/v1/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }

  const clientIp = c.req.header('cf-connecting-ip') || '';
  const guardKeys = loginGuardKeys(clientIp, username);
  const remainingSeconds = await getLockRemaining(c.env.DB, guardKeys);
  if (remainingSeconds > 0) {
    c.header('Retry-After', String(remainingSeconds));
    return c.json({ error: `尝试次数过多，请 ${Math.ceil(remainingSeconds / 60)} 分钟后再试` }, 429);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
  // Run PBKDF2 unconditionally to mitigate timing enumeration
  const valid = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || user.status !== 1 || !valid) {
    await recordLoginFailure(c.env.DB, guardKeys);
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  // Clear username-specific lockout records on successful authentication
  await clearLoginFailures(c.env.DB, guardKeys.filter(k => k.key.startsWith('user:')));

  const secret = await getJwtSecret(c.env.DB);
  const token = await sign({ userId: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, 'HS256');

  return c.json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

authRoute.get('/api/v1/system/profile', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const user = await c.env.DB.prepare('SELECT id, username, role, sub_token, traffic_limit_bytes, used_up_bytes, used_down_bytes, expire_at FROM users WHERE id = ?').bind(currentUser.userId).first<any>();
  return c.json(user || { username: currentUser.username, role: currentUser.role });
});

authRoute.post('/api/v1/system/profile', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json();
  const oldPassword = body.old_password || '';
  const newPassword = body.new_password || '';

  if (newPassword.length < 6) {
    return c.json({ error: '新密码长度不能少于 6 位' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(currentUser.userId).first<any>();
  if (!user) return c.json({ error: '用户不存在' }, 404);

  const valid = await verifyPassword(oldPassword, user.password_hash);
  if (!valid) {
    return c.json({ error: '当前密码验证错误' }, 400);
  }

  const hashed = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?').bind(hashed, user.id).run();

  return c.json({ success: true, username: user.username });
});
