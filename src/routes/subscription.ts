import { Hono } from 'hono';
import { generateToken } from '../keys';
import { buildEndpointsForUser, isUserActive, type NodeRecord } from '../protocol';
import { buildSubscription, toUriString } from '../subscription';
import { getInboundsForSubscription } from '../repo/inbounds';
import { bumpConfigVersion } from '../lib/config-version';
import { authMiddleware } from '../middleware/auth';
import type { AppBindings, AppContext, AppVariables, JwtUser } from '../types';

export const subscriptionRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Whitelist of user fields safe to expose to the web console (no password_hash / proxy credentials)
const toPublicProfile = (u: any) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  sub_token: u.sub_token,
  status: u.status,
  traffic_limit_bytes: u.traffic_limit_bytes,
  used_up_bytes: u.used_up_bytes,
  used_down_bytes: u.used_down_bytes,
  expire_at: u.expire_at
});

subscriptionRoute.get('/api/v1/subscription', authMiddleware, async (c) => {
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
  const allInbounds = await getInboundsForSubscription(c.env.DB, nodeIds);

  const links = buildEndpointsForUser(user, nodes, allInbounds, isAllMode).map(ep => ({
    name: ep.name,
    protocol: ep.protocol === 'hysteria2' ? 'hy2' : 'vless',
    uri: toUriString(ep)
  }));

  return c.json({
    profile: toPublicProfile(user),
    active,
    links,
    mode: isAllMode ? 'all' : (targetUserId !== currentUser.userId ? 'preview' : 'personal')
  });
});

subscriptionRoute.put('/api/v1/subscription', authMiddleware, async (c) => {
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

subscriptionRoute.get('/api/v1/traffic', authMiddleware, async (c) => {
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
    // Admin God-mode: all non-disabled nodes across all tenants with genuine tenant credentials
    nodes = (await c.env.DB.prepare(`
      SELECT n.*, u.username as owner_username, u.uuid as owner_uuid, u.proxy_password as owner_proxy_password
      FROM nodes n
      JOIN users u ON n.owner_id = u.id
      WHERE n.status != 'disabled'
      ORDER BY n.owner_id ASC, n.id ASC
    `).all<any>()).results;
  } else {
    // Non-disabled nodes owned by this user (offline nodes stay listed; admins disable/delete to remove)
    nodes = (await c.env.DB.prepare("SELECT * FROM nodes WHERE owner_id = ? AND status != 'disabled'").bind(user.id).all<NodeRecord>()).results;
  }

  const nodeIds = nodes.map(n => n.id);
  const allInbounds = await getInboundsForSubscription(c.env.DB, nodeIds);

  const endpoints = buildEndpointsForUser(user, nodes, allInbounds, isAllMode);
  const userAgent = c.req.header('User-Agent') || '';
  const sub = buildSubscription(user, endpoints, userAgent);

  for (const [k, v] of Object.entries(sub.headers)) {
    c.header(k, v);
  }
  c.header('Content-Type', sub.contentType);
  c.header('Content-Disposition', `inline; filename="${encodeURIComponent(user.username)}"`);
  return c.body(sub.body);
}

// Universal Client Subscription endpoints: with username and backward compatible
subscriptionRoute.get('/sub/:username/:token', async (c) => {
  return handleSubscription(c as unknown as AppContext, c.req.param('username'), c.req.param('token'));
});

subscriptionRoute.get('/sub/:token', async (c) => {
  return handleSubscription(c as unknown as AppContext, undefined, c.req.param('token'));
});
