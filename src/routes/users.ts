import { Hono } from 'hono';
import { generateToken, generateUUID } from '../keys';
import { hashPassword } from '../lib/crypto';
import { bumpConfigVersion } from '../lib/config-version';
import { authMiddleware, adminOnly } from '../middleware/auth';
import type { AppBindings, AppVariables } from '../types';

export const usersRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

usersRoute.get('/api/v1/users', authMiddleware, adminOnly, async (c) => {
  const users = (await c.env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.traffic_limit_bytes,
           u.used_up_bytes, u.used_down_bytes, u.expire_at, u.sub_token,
           u.created_at,
           COUNT(n.id) as node_count
    FROM users u
    LEFT JOIN nodes n ON n.owner_id = u.id
    GROUP BY u.id
    ORDER BY u.id ASC
  `).all<any>()).results;
  return c.json(users);
});

usersRoute.post('/api/v1/users', authMiddleware, adminOnly, async (c) => {
  const body = await c.req.json();
  const username = (body.username || '').trim();
  const password = body.password || '';
  const role = body.role === 'admin' ? 'admin' : 'user';
  const trafficLimit = parseInt(body.traffic_limit_bytes, 10) || 0;
  const expireAt = body.expire_at || null;

  if (!username) return c.json({ error: '用户名不能为空' }, 400);
  if (password.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return c.json({ error: '用户名已存在' }, 400);

  const hashed = await hashPassword(password);
  const subToken = generateToken(32);
  const uuid = generateUUID();
  const proxyPassword = generateToken(16);

  const res = await c.env.DB.prepare(`
    INSERT INTO users (username, password_hash, role, uuid, proxy_password, sub_token, status, traffic_limit_bytes, expire_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(username, hashed, role, uuid, proxyPassword, subToken, trafficLimit, expireAt).run();

  await bumpConfigVersion(c.env.DB);

  return c.json({
    id: res.meta.last_row_id,
    username,
    role,
    uuid,
    sub_token: subToken,
    traffic_limit_bytes: trafficLimit,
    expire_at: expireAt
  });
});

usersRoute.put('/api/v1/users/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!user) return c.json({ error: '用户不存在' }, 404);

  const body = await c.req.json();
  const trafficLimit = body.traffic_limit_bytes !== undefined ? parseInt(body.traffic_limit_bytes, 10) : user.traffic_limit_bytes;
  const status = body.status !== undefined ? (body.status ? 1 : 0) : user.status;
  const expireAt = body.expire_at !== undefined ? body.expire_at : user.expire_at;

  if (body.password) {
    if (body.password.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);
    const hashed = await hashPassword(body.password);
    await c.env.DB.prepare(`
      UPDATE users SET password_hash = ?, traffic_limit_bytes = ?, status = ?, expire_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(hashed, trafficLimit, status, expireAt, id).run();
  } else {
    await c.env.DB.prepare(`
      UPDATE users SET traffic_limit_bytes = ?, status = ?, expire_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(trafficLimit, status, expireAt, id).run();
  }

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

usersRoute.delete('/api/v1/users/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const user = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<any>();
  if (!user) return c.json({ error: '用户不存在' }, 404);
  if (user.role === 'admin') {
    const adminCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").first<any>();
    if (adminCount.count <= 1) {
      return c.json({ error: '不可删除唯一的超级管理员' }, 400);
    }
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

usersRoute.post('/api/v1/users/:id/reset-traffic', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  await c.env.DB.prepare('UPDATE users SET used_up_bytes = 0, used_down_bytes = 0 WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});
