import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';
import { ensureInitialDefaults, getJwtSecret, isSetupCompleted, type Env } from './db';
import { generateRealityKeyPair, generateToken, generateUUID } from './keys';
import { buildServerConfig, type NodeRecord, type InboundTemplateRecord, type UserRecord } from './protocol';
import { buildSubscription } from './subscription';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Initialize defaults on request
app.use('*', async (c, next) => {
  await ensureInitialDefaults(c.env.DB);
  await next();
});

// Password helpers (PBKDF2 Web Crypto)
async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.includes(':')) {
    return password === storedHash;
  }
  const [saltHex, hashHex] = storedHash.split(':');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const salt = fromHex(saltHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return toHex(new Uint8Array(derived)) === hashHex;
}

// Global config version helper
async function bumpConfigVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'config_version'").first<{ value: string }>();
  const current = row ? parseInt(row.value, 10) || 1 : 1;
  const next = current + 1;
  await db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('config_version', ?)").bind(next.toString()).run();
  return next;
}

async function getConfigVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'config_version'").first<{ value: string }>();
  return row ? parseInt(row.value, 10) || 1 : 1;
}

// JWT Auth Middleware
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.substring(7);
  const secret = await getJwtSecret(c.env.DB);
  try {
    const payload = await verify(token, secret, "HS256");
    c.set('jwtPayload', payload);
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

// ==========================================
// 1. System Setup & Auth
// ==========================================

app.get('/api/v1/system/setup/status', async (c) => {
  const initialized = await isSetupCompleted(c.env.DB);
  return c.json({ is_initialized: initialized });
});

app.post('/api/v1/system/setup', async (c) => {
  if (await isSetupCompleted(c.env.DB)) {
    return c.json({ error: '系统已完成初始化引导，不可重复提交' }, 400);
  }

  const body = await c.req.json();
  const username = (body.username || '').trim();
  const password = body.password || '';
  const confirmPassword = body.confirm_password || '';

  if (!username) return c.json({ error: '管理员用户名不能为空' }, 400);
  if (password.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);
  if (password !== confirmPassword) return c.json({ error: '两次输入的密码不一致' }, 400);

  const hashed = await hashPassword(password);
  const subToken = generateToken(32);
  const uuid = generateUUID();

  // Create or update admin user (ID: 1)
  const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE id = 1').first();
  if (existingUser) {
    await c.env.DB.prepare('UPDATE users SET username = ?, password = ? WHERE id = 1').bind(username, hashed).run();
  } else {
    await c.env.DB.prepare('INSERT INTO users (id, username, uuid, password, sub_token, status) VALUES (1, ?, ?, ?, ?, 1)').bind(username, uuid, hashed, subToken).run();
  }

  // Mark setup completed
  await c.env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('setup_completed', 'true')").run();

  const secret = await getJwtSecret(c.env.DB);
  const token = await sign({ username, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, "HS256");

  return c.json({
    success: true,
    token,
    user: { username }
  });
});

app.post('/api/v1/auth/login', async (c) => {
  const body = await c.req.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
  if (!user) {
    return c.json({ error: 'invalid username or password' }, 401);
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return c.json({ error: 'invalid username or password' }, 401);
  }

  const secret = await getJwtSecret(c.env.DB);
  const token = await sign({ username, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, "HS256");

  return c.json({
    token,
    user: { id: user.id, username: user.username }
  });
});

app.get('/api/v1/system/profile', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare('SELECT username FROM users WHERE id = 1').first<any>();
  return c.json({ username: user?.username || 'admin' });
});

app.post('/api/v1/system/profile', authMiddleware, async (c) => {
  const body = await c.req.json();
  const username = (body.username || '').trim();
  const oldPassword = body.old_password || '';
  const newPassword = body.new_password || '';
  const confirmPassword = body.confirm_password || '';

  const admin = await c.env.DB.prepare('SELECT * FROM users WHERE id = 1').first<any>();
  if (!admin) return c.json({ error: 'Admin not found' }, 404);

  if (newPassword) {
    if (newPassword.length < 6) return c.json({ error: '新密码长度不得少于 6 位' }, 400);
    if (newPassword !== confirmPassword) return c.json({ error: '两次输入的新密码不一致' }, 400);
    const valid = await verifyPassword(oldPassword, admin.password);
    if (!valid) return c.json({ error: '原密码验证失败' }, 400);

    const hashed = await hashPassword(newPassword);
    await c.env.DB.prepare('UPDATE users SET username = ?, password = ? WHERE id = 1').bind(username || admin.username, hashed).run();
  } else if (username && username !== admin.username) {
    await c.env.DB.prepare('UPDATE users SET username = ? WHERE id = 1').bind(username).run();
  }

  return c.json({ success: true, username: username || admin.username });
});

// ==========================================
// 2. Scheme A: VPS Node Sync & Heartbeat
// ==========================================

app.post('/api/v1/node/sync', async (c) => {
  const token = c.req.header('X-Node-Token') || (await c.req.json().catch(() => ({}))).token;
  if (!token) {
    return c.json({ error: 'Missing X-Node-Token' }, 401);
  }

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE token = ?').bind(token).first<NodeRecord & { config_version: number }>();
  if (!node) {
    return c.json({ error: 'Invalid node token' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const now = new Date().toISOString();

  // Detect public IP from CF connecting IP if not manually set
  const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  let serverIP = node.server_ip;
  if (!serverIP && clientIP) {
    serverIP = clientIP;
  }

  // Update node runtime metrics
  await c.env.DB.prepare(`
    UPDATE nodes SET
      status = 'online',
      server_ip = ?,
      last_heartbeat_at = ?,
      rtt_ms = ?,
      cpu_percent = ?,
      memory_percent = ?,
      uptime_seconds = ?,
      core_version = ?
    WHERE id = ?
  `).bind(
    serverIP,
    now,
    body.rtt_ms || 0,
    body.cpu_percent || 0,
    body.memory_percent || 0,
    body.uptime_seconds || 0,
    body.core_version || 'v1.11.4',
    node.id
  ).run();

  // Process traffic reporting deltas
  if (Array.isArray(body.traffic_deltas)) {
    for (const d of body.traffic_deltas) {
      if (d.username && (d.uplink > 0 || d.downlink > 0)) {
        await c.env.DB.prepare(`
          UPDATE users SET
            used_up_bytes = used_up_bytes + ?,
            used_down_bytes = used_down_bytes + ?
          WHERE username = ?
        `).bind(d.uplink || 0, d.downlink || 0, d.username).run();
      }
    }
  }

  // Check if config needs reload
  const globalVersion = await getConfigVersion(c.env.DB);
  const clientConfigVersion = body.config_version || 0;

  if (clientConfigVersion < globalVersion || node.config_version < globalVersion) {
    const template = await c.env.DB.prepare('SELECT * FROM inbound_templates LIMIT 1').first<InboundTemplateRecord>();
    const users = (await c.env.DB.prepare('SELECT * FROM users').all<UserRecord>()).results;

    if (template) {
      const config = buildServerConfig(node, template, users);
      await c.env.DB.prepare('UPDATE nodes SET config_version = ? WHERE id = ?').bind(globalVersion, node.id).run();
      return c.json({
        status: 'ok',
        config_version: globalVersion,
        reload: true,
        config
      });
    }
  }

  return c.json({
    status: 'ok',
    config_version: globalVersion,
    reload: false
  });
});

// ==========================================
// 3. Node Management (Web API)
// ==========================================

app.get('/api/v1/nodes', authMiddleware, async (c) => {
  const nodes = (await c.env.DB.prepare('SELECT * FROM nodes ORDER BY id ASC').all<any>()).results;
  const now = Date.now();

  // Dynamically evaluate stale nodes (heartbeat > 45s => offline)
  const evaluated = nodes.map(n => {
    if (n.status === 'online' && n.last_heartbeat_at) {
      const last = new Date(n.last_heartbeat_at).getTime();
      if (now - last > 45000) {
        n.status = 'offline';
      }
    }
    return n;
  });

  return c.json(evaluated);
});

app.post('/api/v1/nodes', authMiddleware, async (c) => {
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: '主机备注名称不能为空' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM nodes WHERE name = ?').bind(name).first();
  if (existing) return c.json({ error: '主机备注名称已存在，不得重复' }, 400);

  const token = generateUUID();
  const proxyPort = parseInt(body.proxy_port, 10) || 443;
  const protocol = (body.protocol || 'all').toLowerCase();
  const serverIp = (body.server_ip || '').trim();

  const res = await c.env.DB.prepare(`
    INSERT INTO nodes (name, server_ip, proxy_port, protocol, token, status)
    VALUES (?, ?, ?, ?, ?, 'offline')
  `).bind(name, serverIp, proxyPort, protocol, token).run();

  await bumpConfigVersion(c.env.DB);

  const host = c.req.header('host') || 'worker.dev';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const masterUrl = `${proto}://${host}`;

  return c.json({
    id: res.meta.last_row_id,
    name,
    server_ip: serverIp,
    proxy_port: proxyPort,
    protocol,
    token,
    status: 'offline',
    master_url: masterUrl
  }, 201);
});

app.put('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json();

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: 'Node not found' }, 404);

  const name = body.name ? body.name.trim() : node.name;
  const serverIp = body.server_ip !== undefined ? body.server_ip.trim() : node.server_ip;
  const proxyPort = body.proxy_port ? parseInt(body.proxy_port, 10) : node.proxy_port;
  const protocol = body.protocol ? body.protocol.toLowerCase() : node.protocol;
  const status = body.status ? body.status.toLowerCase() : node.status;

  await c.env.DB.prepare(`
    UPDATE nodes SET name = ?, server_ip = ?, proxy_port = ?, protocol = ?, status = ? WHERE id = ?
  `).bind(name, serverIp, proxyPort, protocol, status, id).run();

  await bumpConfigVersion(c.env.DB);

  return c.json({ success: true });
});

app.delete('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

// ==========================================
// 4. User Management (Web API)
// ==========================================

app.get('/api/v1/users', authMiddleware, async (c) => {
  const users = (await c.env.DB.prepare('SELECT * FROM users ORDER BY id ASC').all<any>()).results;
  return c.json(users);
});

app.post('/api/v1/users', authMiddleware, async (c) => {
  const body = await c.req.json();
  const username = (body.username || '').trim();
  if (!username) return c.json({ error: '用户名不能为空' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return c.json({ error: '用户名已存在' }, 400);

  const uuid = generateUUID();
  const password = generateToken(16);
  const subToken = generateToken(32);
  const limitGb = parseInt(body.limit_gb, 10) || 0;
  const limitBytes = limitGb * 1024 * 1024 * 1024;

  let expireAt: string | null = null;
  if (body.expire_days && parseInt(body.expire_days, 10) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(body.expire_days, 10));
    expireAt = d.toISOString();
  }

  const res = await c.env.DB.prepare(`
    INSERT INTO users (username, uuid, password, sub_token, traffic_limit_bytes, expire_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(username, uuid, password, subToken, limitBytes, expireAt).run();

  await bumpConfigVersion(c.env.DB);

  return c.json({
    id: res.meta.last_row_id,
    username,
    uuid,
    sub_token: subToken
  }, 201);
});

app.delete('/api/v1/users/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (id === 1) {
    return c.json({ error: '系统默认初始管理员 (ID: 1) 不可删除' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

// ==========================================
// 5. Inbound Template (Web API)
// ==========================================

app.get('/api/v1/template', authMiddleware, async (c) => {
  const template = await c.env.DB.prepare('SELECT * FROM inbound_templates LIMIT 1').first<any>();
  return c.json(template);
});

app.put('/api/v1/template', authMiddleware, async (c) => {
  const body = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE inbound_templates SET
      reality_dest = ?,
      reality_server_name = ?,
      reality_private_key = ?,
      reality_public_key = ?,
      reality_short_id = ?,
      hy2_up_mbps = ?,
      hy2_down_mbps = ?,
      hy2_masquerade = ?
    WHERE id = 1
  `).bind(
    body.reality_dest,
    body.reality_server_name,
    body.reality_private_key,
    body.reality_public_key,
    body.reality_short_id,
    body.hy2_up_mbps || 100,
    body.hy2_down_mbps || 100,
    body.hy2_masquerade || 'https://bing.com'
  ).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

app.get('/api/v1/template/generate-keys', authMiddleware, async (c) => {
  const keys = generateRealityKeyPair();
  const shortId = generateToken(16);
  return c.json({
    reality_private_key: keys.privateKey,
    reality_public_key: keys.publicKey,
    reality_short_id: shortId
  });
});

// ==========================================
// 6. Subscriptions
// ==========================================

app.get('/sub/:token', async (c) => {
  const token = c.req.param('token');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE sub_token = ?').bind(token).first<any>();
  if (!user || user.status !== 1) {
    return c.text('Subscription not found or disabled', 404);
  }

  const nodes = (await c.env.DB.prepare("SELECT * FROM nodes WHERE status = 'online'").all<NodeRecord>()).results;
  const template = await c.env.DB.prepare('SELECT * FROM inbound_templates LIMIT 1').first<InboundTemplateRecord>();
  if (!template) {
    return c.text('Template not configured', 500);
  }

  const userAgent = c.req.header('User-Agent') || '';
  const sub = buildSubscription(user, nodes, template, userAgent);

  for (const [k, v] of Object.entries(sub.headers)) {
    c.header(k, v);
  }
  c.header('Content-Type', sub.contentType);
  return c.body(sub.body);
});

// Fallback to static assets
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('SM-UI Cloudflare Worker Master API is Running');
});

export default app;
