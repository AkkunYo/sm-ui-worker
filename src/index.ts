import { Hono, type Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { ensureInitialDefaults, getJwtSecret, isSetupCompleted, type Env } from './db';
import { generateRealityKeyPair, generateToken, generateUUID } from './keys';
import { loginGuardKeys, getLockRemaining, recordLoginFailure, clearLoginFailures } from './login-guard';
import { buildServerConfig, isUserActive, type NodeRecord, type InboundTemplateRecord, type NodeInboundSlot, type UserRecord } from './protocol';
import { buildSubscription } from './subscription';

interface JwtUser {
  userId: number;
  username: string;
  role: 'admin' | 'user';
}

type AppContext = Context<{ Bindings: Env; Variables: { user: JwtUser } }>;

const app = new Hono<{ Bindings: Env; Variables: { user: JwtUser } }>();

// Initialize defaults only on API routes (static assets bypass DB)
app.use('/api/*', async (c, next) => {
  await ensureInitialDefaults(c.env.DB);
  await next();
});

// Password helpers (PBKDF2 Web Crypto)
const STORED_HASH_RE = /^[0-9a-f]{32}:[0-9a-f]{64}$/i;
const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`;

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
  if (!STORED_HASH_RE.test(storedHash || '')) {
    return false;
  }
  const [saltHex, hashHex] = storedHash.split(':');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return crypto.subtle.timingSafeEqual(new Uint8Array(derived), expected);
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

// JWT Auth Middleware with live DB status check
const authMiddleware = async (c: AppContext, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.substring(7);
  const secret = await getJwtSecret(c.env.DB);
  try {
    const payload = (await verify(token, secret, "HS256")) as unknown as JwtUser;
    const liveUser = await c.env.DB.prepare('SELECT id, username, role, status FROM users WHERE id = ?').bind(payload.userId).first<any>();
    if (!liveUser || liveUser.status !== 1) {
      return c.json({ error: '用户不存在或已被禁用' }, 401);
    }
    c.set('user', { userId: liveUser.id, username: liveUser.username, role: liveUser.role });
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

const adminOnly = async (c: AppContext, next: any) => {
  const user = c.get('user') as JwtUser;
  if (user?.role !== 'admin') {
    return c.json({ error: 'Forbidden: 管理员专属操作' }, 403);
  }
  await next();
};

// ==========================================
// 1. System Setup & Auth
// ==========================================

app.get('/api/v1/system/setup/status', async (c) => {
  const initialized = await isSetupCompleted(c.env.DB);
  return c.json({ is_initialized: initialized, version: '1.1.0' });
});

app.post('/api/v1/system/setup', async (c) => {
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
    ) VALUES (NULL, '默认 VLESS-Reality', 'vless', 'www.amazon.com:443', 'www.amazon.com', ?, ?, ?, 1)
  `).bind(keys.privateKey, keys.publicKey, shortId).run();

  await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      owner_id, name, protocol, hy2_up_mbps, hy2_down_mbps, hy2_masquerade, is_default
    ) VALUES (NULL, '默认 Hysteria 2', 'hysteria2', 100, 100, 'https://bing.com', 1)
  `).run();

  // Mark setup completed
  await c.env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('setup_completed', 'true')").run();

  const secret = await getJwtSecret(c.env.DB);
  const token = await sign({ userId: adminId, username, role: 'admin', exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, "HS256");

  return c.json({
    success: true,
    token,
    user: { id: adminId, username, role: 'admin' }
  });
});

app.post('/api/v1/auth/login', async (c) => {
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
  const token = await sign({ userId: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }, secret, "HS256");

  return c.json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

app.get('/api/v1/system/profile', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const user = await c.env.DB.prepare('SELECT id, username, role, sub_token, traffic_limit_bytes, used_up_bytes, used_down_bytes, expire_at FROM users WHERE id = ?').bind(currentUser.userId).first<any>();
  return c.json(user || { username: currentUser.username, role: currentUser.role });
});

app.post('/api/v1/system/profile', authMiddleware, async (c) => {
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

// ==========================================
// 2. Scheme A: VPS Node Sync & Heartbeat
// ==========================================

app.post('/api/v1/node/sync', async (c) => {
  const token = c.req.header('X-Node-Token') || (await c.req.json().catch(() => ({}))).token;
  if (!token) {
    return c.json({ error: 'Missing X-Node-Token' }, 401);
  }

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE token = ?').bind(token).first<NodeRecord & { config_version: number; owner_id: number }>();
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
    body.core_version || 'v1.14.2',
    node.id
  ).run();

  // Process traffic reporting deltas: enforce non-negative integers and strict tenant scope
  let nodeDeltaUp = 0;
  let nodeDeltaDown = 0;
  if (Array.isArray(body.traffic_deltas)) {
    const nodeOwner = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(node.owner_id).first<{ id: number; username: string }>();
    const MAX_DELTA_BYTES = 500 * 1024 * 1024 * 1024; // 500 GB ceiling per 30s heartbeat

    for (const d of body.traffic_deltas) {
      const up = Number(d?.uplink);
      const down = Number(d?.downlink);

      // Validate integers, non-negative, and sane upper limit
      if (!Number.isSafeInteger(up) || !Number.isSafeInteger(down) || up < 0 || down < 0 || up > MAX_DELTA_BYTES || down > MAX_DELTA_BYTES) {
        continue;
      }
      if (up === 0 && down === 0) {
        continue;
      }

      // Enforce tenant boundary: node can only report for its owner
      const targetUsername = typeof d?.username === 'string' ? d.username.trim() : '';
      if (nodeOwner && targetUsername && targetUsername !== nodeOwner.username) {
        continue;
      }

      nodeDeltaUp += up;
      nodeDeltaDown += down;

      if (nodeOwner) {
        await c.env.DB.prepare(`
          UPDATE users SET
            used_up_bytes = used_up_bytes + ?,
            used_down_bytes = used_down_bytes + ?
          WHERE id = ?
        `).bind(up, down, nodeOwner.id).run();
      }
    }
  }

  // Atomically update node's own physical traffic
  if (nodeDeltaUp > 0 || nodeDeltaDown > 0) {
    await c.env.DB.prepare(`
      UPDATE nodes SET
        used_up_bytes = used_up_bytes + ?,
        used_down_bytes = used_down_bytes + ?
      WHERE id = ?
    `).bind(nodeDeltaUp, nodeDeltaDown, node.id).run();
  }

  // Check if config needs reload
  const globalVersion = await getConfigVersion(c.env.DB);
  const clientConfigVersion = body.config_version || 0;

  if (clientConfigVersion < globalVersion || node.config_version < globalVersion) {
    const ownerUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(node.owner_id).first<UserRecord>();
    const slots = (await c.env.DB.prepare(`
      SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
             it.name as template_name, it.protocol,
             it.reality_dest, it.reality_server_name, it.reality_private_key, it.reality_public_key, it.reality_short_id,
             it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
      FROM node_inbounds ni
      JOIN inbound_templates it ON ni.template_id = it.id
      WHERE ni.node_id = ? AND (ni.enabled IS NULL OR ni.enabled = 1)
      ORDER BY ni.listen_port ASC, ni.id ASC
    `).bind(node.id).all<NodeInboundSlot>()).results;

    if (ownerUser && slots && slots.length > 0) {
      // STRICT ISOLATION: Node only authorizes its genuine owner user!
      const authUsers: UserRecord[] = [ownerUser];
      const config = buildServerConfig(node, slots, authUsers);
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
  const currentUser = c.get('user') as JwtUser;
  const now = Date.now();

  let nodes: any[] = [];
  if (currentUser.role === 'admin') {
    const ownerFilter = c.req.query('owner_id');
    if (ownerFilter) {
      nodes = (await c.env.DB.prepare(`
        SELECT n.*, u.username as owner_username
        FROM nodes n
        JOIN users u ON n.owner_id = u.id
        WHERE n.owner_id = ?
        ORDER BY n.id ASC
      `).bind(parseInt(ownerFilter, 10)).all<any>()).results;
    } else {
      nodes = (await c.env.DB.prepare(`
        SELECT n.*, u.username as owner_username
        FROM nodes n
        JOIN users u ON n.owner_id = u.id
        ORDER BY n.id ASC
      `).all<any>()).results;
    }
  } else {
    // Tenant only sees their own nodes
    nodes = (await c.env.DB.prepare(`
      SELECT n.*, u.username as owner_username
      FROM nodes n
      JOIN users u ON n.owner_id = u.id
      WHERE n.owner_id = ?
      ORDER BY n.id ASC
    `).bind(currentUser.userId).all<any>()).results;
  }

  const nodeIds = nodes.map(n => n.id);
  let allInbounds: any[] = [];
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',');
    allInbounds = (await c.env.DB.prepare(`
      SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
             it.name as template_name, it.protocol,
             it.reality_dest, it.reality_server_name, it.reality_private_key, it.reality_public_key, it.reality_short_id,
             it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
      FROM node_inbounds ni
      JOIN inbound_templates it ON ni.template_id = it.id
      WHERE ni.node_id IN (${placeholders})
      ORDER BY ni.listen_port ASC, ni.id ASC
    `).bind(...nodeIds).all<any>()).results;
  }

  const evaluated = nodes.map(n => {
    let currentStatus = n.status;
    if (currentStatus === 'online' && n.last_heartbeat_at) {
      const last = new Date(n.last_heartbeat_at).getTime();
      if (now - last > 90000) {
        currentStatus = 'offline';
      }
    }
    const nodeSlots = allInbounds.filter(s => s.node_id === n.id);
    return {
      ...n,
      inbounds: nodeSlots,
      status: currentStatus,
      core_state: currentStatus === 'online' ? 'running' : 'stopped',
      config_status: 'applied',
      is_local: false
    };
  });

  return c.json(evaluated);
});

app.post('/api/v1/nodes', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: '主机备注名称不能为空' }, 400);

  let ownerId = currentUser.userId;
  if (currentUser.role === 'admin' && body.owner_id) {
    ownerId = parseInt(body.owner_id, 10);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM nodes WHERE owner_id = ? AND name = ?').bind(ownerId, name).first();
  if (existing) return c.json({ error: '该租户名下主机名称已存在，不得重复' }, 400);

  const token = generateUUID();
  const proxyPort = parseInt(body.proxy_port, 10) || 2096;
  const hopPorts = (body.hop_ports || '').trim();
  const protocol = (body.protocol || 'all').toLowerCase();
  const serverIp = (body.server_ip || '').trim();

  const res = await c.env.DB.prepare(`
    INSERT INTO nodes (owner_id, name, server_ip, proxy_port, hop_ports, protocol, token, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')
  `).bind(ownerId, name, serverIp, proxyPort, hopPorts, protocol, token).run();

  const nodeId = res.meta.last_row_id;

  // Insert inbound slots
  if (Array.isArray(body.inbounds) && body.inbounds.length > 0) {
    for (const slot of body.inbounds) {
      if (slot.template_id) {
        await c.env.DB.prepare(`
          INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          nodeId,
          parseInt(slot.template_id, 10),
          parseInt(slot.listen_port, 10) || proxyPort,
          (slot.hop_ports || '').trim(),
          slot.enabled !== undefined ? (slot.enabled ? 1 : 0) : 1
        ).run();
      }
    }
  } else {
    // Default: bind default system templates on proxyPort
    const defaultTemplates = (await c.env.DB.prepare(`
      SELECT id, protocol FROM inbound_templates WHERE owner_id IS NULL AND is_default = 1
    `).all<{ id: number; protocol: string }>()).results;

    for (const tmpl of defaultTemplates) {
      await c.env.DB.prepare(`
        INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).bind(
        nodeId,
        tmpl.id,
        proxyPort,
        tmpl.protocol === 'hysteria2' ? hopPorts : ''
      ).run();
    }
  }

  await bumpConfigVersion(c.env.DB);

  const host = c.req.header('host') || 'worker.dev';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const masterUrl = `${proto}://${host}`;

  return c.json({
    id: nodeId,
    owner_id: ownerId,
    name,
    server_ip: serverIp,
    proxy_port: proxyPort,
    hop_ports: hopPorts,
    protocol,
    token,
    status: 'offline',
    master_url: masterUrl
  }, 201);
});

app.put('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json();

  let node: any = null;
  if (currentUser.role === 'admin') {
    node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  } else {
    node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND owner_id = ?').bind(id, currentUser.userId).first<any>();
  }
  if (!node) return c.json({ error: '主机不存在或无权限编辑' }, 404);

  const name = body.name ? body.name.trim() : node.name;
  const serverIp = body.server_ip !== undefined ? body.server_ip.trim() : node.server_ip;
  const proxyPort = body.proxy_port ? parseInt(body.proxy_port, 10) : node.proxy_port;
  const hopPorts = body.hop_ports !== undefined ? body.hop_ports.trim() : (node.hop_ports || '');
  const protocol = body.protocol ? body.protocol.toLowerCase() : node.protocol;
  const status = body.status ? body.status.toLowerCase() : node.status;
  const ownerId = (currentUser.role === 'admin' && body.owner_id) ? parseInt(body.owner_id, 10) : node.owner_id;

  await c.env.DB.prepare(`
    UPDATE nodes SET owner_id = ?, name = ?, server_ip = ?, proxy_port = ?, hop_ports = ?, protocol = ?, status = ? WHERE id = ?
  `).bind(ownerId, name, serverIp, proxyPort, hopPorts, protocol, status, id).run();

  // If inbounds slots provided, update them
  if (Array.isArray(body.inbounds)) {
    await c.env.DB.prepare('DELETE FROM node_inbounds WHERE node_id = ?').bind(id).run();
    for (const slot of body.inbounds) {
      if (slot.template_id) {
        await c.env.DB.prepare(`
          INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          id,
          parseInt(slot.template_id, 10),
          parseInt(slot.listen_port, 10) || proxyPort,
          (slot.hop_ports || '').trim(),
          slot.enabled !== undefined ? (slot.enabled ? 1 : 0) : 1
        ).run();
      }
    }
  }

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

app.delete('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);

  if (currentUser.role === 'admin') {
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  } else {
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ? AND owner_id = ?').bind(id, currentUser.userId).run();
  }
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

// ==========================================
// 4. Tenant User Management (Admin Only)
// ==========================================

app.get('/api/v1/users', authMiddleware, adminOnly, async (c) => {
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

app.post('/api/v1/users', authMiddleware, adminOnly, async (c) => {
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

  const userId = res.meta.last_row_id;

  return c.json({
    id: userId,
    username,
    role,
    uuid,
    sub_token: subToken,
    traffic_limit_bytes: trafficLimit,
    status: 1
  }, 201);
});

app.put('/api/v1/users/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json();

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!user) return c.json({ error: '用户不存在' }, 404);

  let passwordHash = user.password_hash;
  if (body.password && body.password.length >= 6) {
    passwordHash = await hashPassword(body.password);
  }

  let subToken = user.sub_token;
  if (body.reset_subscription) {
    subToken = generateToken(32);
  }

  const status = body.status !== undefined ? (body.status ? 1 : 0) : user.status;
  const trafficLimit = body.traffic_limit_bytes !== undefined ? parseInt(body.traffic_limit_bytes, 10) : user.traffic_limit_bytes;
  const expireAt = body.clear_expiry ? null : (body.expire_at !== undefined ? body.expire_at : user.expire_at);
  const role = body.role ? (body.role === 'admin' ? 'admin' : 'user') : user.role;

  await c.env.DB.prepare(`
    UPDATE users SET
      password_hash = ?,
      sub_token = ?,
      status = ?,
      traffic_limit_bytes = ?,
      expire_at = ?,
      role = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(passwordHash, subToken, status, trafficLimit, expireAt, role, id).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

app.delete('/api/v1/users/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const currentUser = c.get('user') as JwtUser;
  if (id === 1 || id === currentUser.userId) {
    return c.json({ error: '系统初始管理员或自身账号不可删除' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

// ==========================================
// 5. Inbound Templates (Template Pool Web API)
// ==========================================

app.get('/api/v1/templates', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  let templates: any[] = [];
  if (currentUser.role === 'admin') {
    templates = (await c.env.DB.prepare(`
      SELECT t.*, u.username as owner_username
      FROM inbound_templates t
      LEFT JOIN users u ON t.owner_id = u.id
      ORDER BY t.owner_id ASC, t.protocol ASC, t.id ASC
    `).all<any>()).results;
  } else {
    templates = (await c.env.DB.prepare(`
      SELECT t.*
      FROM inbound_templates t
      WHERE t.owner_id IS NULL OR t.owner_id = ?
      ORDER BY t.owner_id ASC, t.protocol ASC, t.id ASC
    `).bind(currentUser.userId).all<any>()).results;
  }
  return c.json(templates);
});

app.post('/api/v1/templates', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json();
  const name = (body.name || '').trim();
  const protocol = (body.protocol || '').toLowerCase();

  if (!name) return c.json({ error: '模板名称不能为空' }, 400);
  if (protocol !== 'vless' && protocol !== 'hysteria2') {
    return c.json({ error: '协议类型必须为 vless 或 hysteria2' }, 400);
  }

  let ownerId: number | null = currentUser.userId;
  if (currentUser.role === 'admin' && body.is_system) {
    ownerId = null;
  }

  const isDefault = body.is_default ? 1 : 0;
  let realityDest = body.reality_dest || 'www.amazon.com:443';
  let realityServerName = body.reality_server_name || 'www.amazon.com';
  let realityPrivateKey = body.reality_private_key || null;
  let realityPublicKey = body.reality_public_key || null;
  let realityShortId = body.reality_short_id || null;

  if (protocol === 'vless' && (!realityPrivateKey || !realityPublicKey)) {
    const keys = generateRealityKeyPair();
    realityPrivateKey = keys.privateKey;
    realityPublicKey = keys.publicKey;
    if (!realityShortId) realityShortId = generateToken(16);
  }

  const hy2UpMbps = parseInt(body.hy2_up_mbps, 10) || 100;
  const hy2DownMbps = parseInt(body.hy2_down_mbps, 10) || 100;
  const hy2Masquerade = body.hy2_masquerade || 'https://bing.com';

  const res = await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      owner_id, name, protocol, reality_dest, reality_server_name,
      reality_private_key, reality_public_key, reality_short_id,
      hy2_up_mbps, hy2_down_mbps, hy2_masquerade, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ownerId, name, protocol, realityDest, realityServerName,
    realityPrivateKey, realityPublicKey, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, isDefault
  ).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ id: res.meta.last_row_id, success: true }, 201);
});

app.put('/api/v1/templates/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json();

  const template = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  if (!template) return c.json({ error: '模板不存在' }, 404);

  if (template.owner_id === null && currentUser.role !== 'admin') {
    return c.json({ error: '无权修改系统级公共模板' }, 403);
  }
  if (template.owner_id !== null && template.owner_id !== currentUser.userId && currentUser.role !== 'admin') {
    return c.json({ error: '无权修改其他租户的私有模板' }, 403);
  }

  const name = body.name ? body.name.trim() : template.name;
  const isDefault = body.is_default !== undefined ? (body.is_default ? 1 : 0) : template.is_default;
  const realityDest = body.reality_dest !== undefined ? body.reality_dest : template.reality_dest;
  const realityServerName = body.reality_server_name !== undefined ? body.reality_server_name : template.reality_server_name;
  const realityPrivateKey = body.reality_private_key !== undefined ? body.reality_private_key : template.reality_private_key;
  const realityPublicKey = body.reality_public_key !== undefined ? body.reality_public_key : template.reality_public_key;
  const realityShortId = body.reality_short_id !== undefined ? body.reality_short_id : template.reality_short_id;
  const hy2UpMbps = body.hy2_up_mbps !== undefined ? parseInt(body.hy2_up_mbps, 10) : template.hy2_up_mbps;
  const hy2DownMbps = body.hy2_down_mbps !== undefined ? parseInt(body.hy2_down_mbps, 10) : template.hy2_down_mbps;
  const hy2Masquerade = body.hy2_masquerade !== undefined ? body.hy2_masquerade : template.hy2_masquerade;

  await c.env.DB.prepare(`
    UPDATE inbound_templates SET
      name = ?,
      reality_dest = ?,
      reality_server_name = ?,
      reality_private_key = ?,
      reality_public_key = ?,
      reality_short_id = ?,
      hy2_up_mbps = ?,
      hy2_down_mbps = ?,
      hy2_masquerade = ?,
      is_default = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    name, realityDest, realityServerName, realityPrivateKey, realityPublicKey, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, isDefault, id
  ).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

app.delete('/api/v1/templates/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);

  const template = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  if (!template) return c.json({ error: '模板不存在' }, 404);

  if (template.owner_id === null && currentUser.role !== 'admin') {
    return c.json({ error: '无权删除系统级公共模板' }, 403);
  }
  if (template.owner_id !== null && template.owner_id !== currentUser.userId && currentUser.role !== 'admin') {
    return c.json({ error: '无权删除其他租户的私有模板' }, 403);
  }

  const used = await c.env.DB.prepare('SELECT COUNT(*) as count FROM node_inbounds WHERE template_id = ?').bind(id).first<{ count: number }>();
  if ((used?.count || 0) > 0) {
    return c.json({ error: `该模板正被 ${used!.count} 个主机插槽使用，请先从主机解绑再删除` }, 400);
  }

  await c.env.DB.prepare('DELETE FROM inbound_templates WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

// Backward-compatible single template query
app.get('/api/v1/template', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const template = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE owner_id = ? OR owner_id IS NULL ORDER BY owner_id DESC, id ASC LIMIT 1').bind(currentUser.userId).first<any>();
  return c.json(template || {});
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
// 6. Subscriptions & Traffic
// ==========================================

app.get('/api/v1/subscription', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const targetUserId = (currentUser.role === 'admin' && c.req.query('user_id'))
    ? parseInt(c.req.query('user_id')!, 10)
    : currentUser.userId;

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!user) {
    return c.json({ error: '用户未找到' }, 404);
  }

  const isAllMode = currentUser.role === 'admin' && c.req.query('all') === 'true' && targetUserId === currentUser.userId;

  const usedBytes = (user.used_up_bytes || 0) + (user.used_down_bytes || 0);
  const isTrafficExceeded = user.traffic_limit_bytes > 0 && usedBytes >= user.traffic_limit_bytes;
  const isExpired = user.expire_at ? new Date(user.expire_at) <= new Date() : false;
  const active = user.status === 1 && !isTrafficExceeded && !isExpired;

  let nodes: any[] = [];
  if (isAllMode) {
    // Admin God-mode: All non-disabled nodes across all tenants with genuine owner credentials
    nodes = (await c.env.DB.prepare(`
      SELECT n.*, u.username as owner_username, u.uuid as owner_uuid, u.proxy_password as owner_proxy_password
      FROM nodes n
      JOIN users u ON n.owner_id = u.id
      WHERE n.status != 'disabled'
      ORDER BY n.owner_id ASC, n.id ASC
    `).all<any>()).results;
  } else {
    // Nodes belonging ONLY to this user!
    nodes = (await c.env.DB.prepare("SELECT * FROM nodes WHERE owner_id = ? AND status != 'disabled'").bind(user.id).all<any>()).results;
  }

  const nodeIds = nodes.map(n => n.id);
  let allInbounds: any[] = [];
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',');
    allInbounds = (await c.env.DB.prepare(`
      SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
             it.name as template_name, it.protocol,
             it.reality_dest, it.reality_server_name, it.reality_private_key, it.reality_public_key, it.reality_short_id,
             it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
      FROM node_inbounds ni
      JOIN inbound_templates it ON ni.template_id = it.id
      WHERE ni.node_id IN (${placeholders}) AND (ni.enabled IS NULL OR ni.enabled = 1)
      ORDER BY ni.listen_port ASC, ni.id ASC
    `).bind(...nodeIds).all<any>()).results;
  }

  const links: Array<{ name: string; protocol: string; uri: string }> = [];
  for (const node of nodes) {
    if (!node.server_ip) continue;
    const ips = node.server_ip.split(',').map((s: string) => s.trim()).filter(Boolean);
    const targetIP = ips[0] || '';
    if (!targetIP) continue;

    const suffix = isAllMode && node.owner_username ? ` [${node.owner_username}]` : '';
    const nodeUuid = (isAllMode && node.owner_uuid) ? node.owner_uuid : user.uuid;
    const nodePassword = (isAllMode && node.owner_proxy_password) ? node.owner_proxy_password : (user.proxy_password || 'sm-ui-password');

    const slots = allInbounds.filter(s => s.node_id === node.id);
    for (const slot of slots) {
      const portSuffix = slot.listen_port === 2096 ? '' : `:${slot.listen_port}`;
      if (slot.protocol === 'vless') {
        const vlessName = `${node.name}-VLESS-${targetIP}${portSuffix}${suffix}`;
        const remark = encodeURIComponent(vlessName);
        const vlessURI = `vless://${nodeUuid}@${targetIP}:${slot.listen_port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${encodeURIComponent(slot.reality_server_name || 'www.amazon.com')}&fp=chrome&pbk=${encodeURIComponent(slot.reality_public_key || '')}&sid=${encodeURIComponent(slot.reality_short_id || '0123456789abcdef')}&type=tcp&headerType=none#${remark}`;
        links.push({
          name: vlessName,
          protocol: 'vless',
          uri: vlessURI
        });
      } else if (slot.protocol === 'hysteria2') {
        const hy2Name = `${node.name}-Hy2-${targetIP}${portSuffix}${suffix}`;
        const remark = encodeURIComponent(hy2Name);
        let hy2Sni = slot.reality_server_name || targetIP;
        if (slot.hy2_masquerade) {
          try {
            const u = new URL(slot.hy2_masquerade.startsWith('http') ? slot.hy2_masquerade : `https://${slot.hy2_masquerade}`);
            if (u.hostname) hy2Sni = u.hostname;
          } catch {}
        }
        const upMbps = slot.hy2_up_mbps || 100;
        const downMbps = slot.hy2_down_mbps || 100;
        const hy2URI = `hysteria2://${encodeURIComponent(nodePassword)}@${targetIP}:${slot.listen_port}?alpn=h3&insecure=1&allowInsecure=1&sni=${encodeURIComponent(hy2Sni)}&upmbps=${upMbps}&downmbps=${downMbps}#${remark}`;
        links.push({
          name: hy2Name,
          protocol: 'hy2',
          uri: hy2URI
        });

        if (slot.hop_ports && slot.hop_ports.trim()) {
          const hopName = `${node.name}-Hy2-Hop-${targetIP}${suffix}`;
          const hopRemark = encodeURIComponent(hopName);
          const hopPortRange = slot.hop_ports.trim();
          const hopURI = `hysteria2://${encodeURIComponent(nodePassword)}@${targetIP}:${hopPortRange}?alpn=h3&insecure=1&allowInsecure=1&mport=${encodeURIComponent(hopPortRange)}&sni=${encodeURIComponent(hy2Sni)}&upmbps=${upMbps}&downmbps=${downMbps}#${hopRemark}`;
          links.push({
            name: hopName,
            protocol: 'hy2',
            uri: hopURI
          });
        }
      }
    }
  }

  return c.json({
    profile: user,
    active,
    links,
    mode: isAllMode ? 'all' : (targetUserId !== currentUser.userId ? 'preview' : 'personal')
  });
});

app.put('/api/v1/subscription', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(currentUser.userId).first<any>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const body = await c.req.json();
  if (body.reset_subscription) {
    const newToken = generateToken(32);
    await c.env.DB.prepare('UPDATE users SET sub_token = ? WHERE id = ?').bind(newToken, user.id).run();
    await bumpConfigVersion(c.env.DB);
    return c.json({ success: true, sub_token: newToken });
  }

  let proxyPassword = user.proxy_password;
  if (body.password) {
    proxyPassword = body.password;
  }

  await c.env.DB.prepare(`
    UPDATE users SET proxy_password = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(proxyPassword, user.id).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

app.get('/api/v1/traffic', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;

  if (currentUser.role === 'admin') {
    // Only real proxy users, excluding system admin!
    const users = (await c.env.DB.prepare("SELECT id, username, used_up_bytes, used_down_bytes, traffic_limit_bytes FROM users WHERE role != 'admin'").all<any>()).results;
    const nodes = (await c.env.DB.prepare('SELECT id, name, used_up_bytes, used_down_bytes FROM nodes').all<any>()).results;

    let totalUplink = 0;
    let totalDownlink = 0;
    const hostItems = nodes.map(n => {
      const up = n.used_up_bytes || 0;
      const down = n.used_down_bytes || 0;
      totalUplink += up;
      totalDownlink += down;
      return { id: n.id, name: n.name, uplink: up, downlink: down };
    });

    const userItems = users.map(u => ({
      id: u.id,
      name: u.username,
      uplink: u.used_up_bytes || 0,
      downlink: u.used_down_bytes || 0,
      traffic_limit_bytes: u.traffic_limit_bytes || 0
    }));

    return c.json({
      total: { uplink: totalUplink, downlink: totalDownlink },
      hosts: hostItems,
      protocols: [], // Real protocol metrics require inbound telemetry from agent; omitted to avoid fabricated ratio
      users: userItems
    });
  } else {
    // Tenant only sees their own traffic
    const user = await c.env.DB.prepare('SELECT id, username, used_up_bytes, used_down_bytes, traffic_limit_bytes FROM users WHERE id = ?').bind(currentUser.userId).first<any>();
    const nodes = (await c.env.DB.prepare('SELECT id, name, used_up_bytes, used_down_bytes FROM nodes WHERE owner_id = ?').bind(currentUser.userId).all<any>()).results;

    const up = user?.used_up_bytes || 0;
    const down = user?.used_down_bytes || 0;

    const hostItems = nodes.map(n => ({
      id: n.id,
      name: n.name,
      uplink: n.used_up_bytes || 0,
      downlink: n.used_down_bytes || 0
    }));

    return c.json({
      total: { uplink: up, downlink: down },
      hosts: hostItems,
      protocols: [], // Real protocol metrics require inbound telemetry from agent; omitted to avoid fabricated ratio
      users: [{
        id: currentUser.userId,
        name: currentUser.username,
        uplink: up,
        downlink: down,
        traffic_limit_bytes: user?.traffic_limit_bytes || 0
      }]
    });
  }
});

// Shared Subscription Handler supporting both /sub/:username/:token and /sub/:token
async function handleSubscription(c: AppContext, usernameParam?: string, tokenParam?: string) {
  const token = tokenParam || c.req.param('token');
  const username = usernameParam || c.req.param('username');

  let user: any = null;
  if (username && token) {
    user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND sub_token = ?').bind(username, token).first<any>();
  } else if (token) {
    user = await c.env.DB.prepare('SELECT * FROM users WHERE sub_token = ?').bind(token).first<any>();
  }

  if (!user || !isUserActive(user)) {
    return c.text('Subscription not found, expired, or traffic limit exceeded', 403);
  }

  const isAllMode = user.role === 'admin' && c.req.query('all') === 'true';

  let nodes: any[] = [];
  if (isAllMode) {
    // Admin God-mode: query all online nodes across all tenants with genuine tenant credentials
    nodes = (await c.env.DB.prepare(`
      SELECT n.*, u.username as owner_username, u.uuid as owner_uuid, u.proxy_password as owner_proxy_password
      FROM nodes n
      JOIN users u ON n.owner_id = u.id
      WHERE n.status = 'online'
      ORDER BY n.owner_id ASC, n.id ASC
    `).all<any>()).results;
  } else {
    // ONLY online nodes owned by this user!
    nodes = (await c.env.DB.prepare("SELECT * FROM nodes WHERE owner_id = ? AND status = 'online'").bind(user.id).all<NodeRecord>()).results;
  }

  const nodeIds = nodes.map(n => n.id);
  let allInbounds: any[] = [];
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',');
    allInbounds = (await c.env.DB.prepare(`
      SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
             it.name as template_name, it.protocol,
             it.reality_dest, it.reality_server_name, it.reality_private_key, it.reality_public_key, it.reality_short_id,
             it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
      FROM node_inbounds ni
      JOIN inbound_templates it ON ni.template_id = it.id
      WHERE ni.node_id IN (${placeholders}) AND (ni.enabled IS NULL OR ni.enabled = 1)
      ORDER BY ni.listen_port ASC, ni.id ASC
    `).bind(...nodeIds).all<any>()).results;
  }

  const mappedNodes = nodes.map(n => ({
    ...n,
    owner_username: isAllMode ? (n as any).owner_username : undefined,
    owner_uuid: isAllMode ? (n as any).owner_uuid : undefined,
    owner_proxy_password: isAllMode ? (n as any).owner_proxy_password : undefined,
    inbounds: allInbounds.filter(s => s.node_id === n.id)
  }));

  const userAgent = c.req.header('User-Agent') || '';
  const sub = buildSubscription(user, mappedNodes, userAgent);

  for (const [k, v] of Object.entries(sub.headers)) {
    c.header(k, v);
  }
  c.header('Content-Type', sub.contentType);
  c.header('Content-Disposition', `inline; filename="${encodeURIComponent(user.username)}"`);
  return c.body(sub.body);
}

// Universal Client Subscription endpoints: with username and backward compatible
app.get('/sub/:username/:token', async (c) => {
  return handleSubscription(c, c.req.param('username'), c.req.param('token'));
});

app.get('/sub/:token', async (c) => {
  return handleSubscription(c, undefined, c.req.param('token'));
});

// Fallback to static assets
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('SM-UI Cloudflare Worker Master API is Running');
});

export default app;
