import { Hono } from 'hono';
import { generateToken } from '../keys';
import { getInboundsForSubscription } from '../repo/inbounds';
import { bumpConfigVersion } from '../lib/config-version';
import { validateTemplateBindings, type RequestedNodeSlot } from '../lib/template-access';
import { authMiddleware } from '../middleware/auth';
import type { AppBindings, AppVariables, JwtUser } from '../types';

export const nodesRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

function normalizeSlots(raw: unknown, fallbackPort: number, fallbackHopPorts: string): RequestedNodeSlot[] | null | undefined {
  if (!Array.isArray(raw)) return null;
  const slots: RequestedNodeSlot[] = [];
  for (const slot of raw) {
    const templateId = Number.parseInt(String(slot?.template_id || ''), 10);
    if (!Number.isInteger(templateId) || templateId <= 0) return undefined;
    const listenPort = Number.parseInt(String(slot?.listen_port || ''), 10) || fallbackPort;
    if (listenPort < 1 || listenPort > 65535) return undefined;
    slots.push({
      template_id: templateId,
      listen_port: listenPort,
      hop_ports: typeof slot?.hop_ports === 'string' ? slot.hop_ports.trim() : fallbackHopPorts,
      enabled: slot?.enabled === undefined ? 1 : (slot.enabled ? 1 : 0)
    });
  }
  const keys = slots.map(slot => `${slot.template_id}:${slot.listen_port}`);
  if (new Set(keys).size !== keys.length) return undefined;
  return slots;
}

async function existingSlots(db: D1Database, nodeId: number): Promise<RequestedNodeSlot[]> {
  const rows = (await db.prepare('SELECT template_id, listen_port, hop_ports, enabled FROM node_inbounds WHERE node_id = ? ORDER BY id ASC').bind(nodeId).all<RequestedNodeSlot>()).results;
  return rows.map(row => ({
    template_id: Number(row.template_id),
    listen_port: Number(row.listen_port),
    hop_ports: row.hop_ports || '',
    enabled: row.enabled === undefined ? 1 : Number(row.enabled)
  }));
}

function insertSlotStatements(db: D1Database, nodeId: number | 'last_insert_rowid()', slots: RequestedNodeSlot[]): D1PreparedStatement[] {
  return slots.map(slot => db.prepare(`
    INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
    VALUES (${nodeId === 'last_insert_rowid()' ? 'last_insert_rowid()' : '?'}, ?, ?, ?, ?)
  `).bind(...(nodeId === 'last_insert_rowid()'
    ? [slot.template_id, slot.listen_port, slot.hop_ports, slot.enabled]
    : [nodeId, slot.template_id, slot.listen_port, slot.hop_ports, slot.enabled])));
}

nodesRoute.get('/api/v1/nodes', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const now = Date.now();
  let nodes: any[] = [];
  if (currentUser.role === 'admin') {
    const ownerFilter = c.req.query('owner_id');
    const query = `
      SELECT n.*, u.username as owner_username
      FROM nodes n JOIN users u ON n.owner_id = u.id
      ${ownerFilter ? 'WHERE n.owner_id = ?' : ''}
      ORDER BY n.id ASC
    `;
    nodes = (await c.env.DB.prepare(query).bind(...(ownerFilter ? [Number.parseInt(ownerFilter, 10)] : [])).all<any>()).results;
  } else {
    nodes = (await c.env.DB.prepare(`
      SELECT n.*, u.username as owner_username
      FROM nodes n JOIN users u ON n.owner_id = u.id
      WHERE n.owner_id = ? ORDER BY n.id ASC
    `).bind(currentUser.userId).all<any>()).results;
  }

  const allInbounds = await getInboundsForSubscription(c.env.DB, nodes.map(n => n.id), true);
  return c.json(nodes.map(n => {
    let currentStatus = n.status;
    if (currentStatus === 'online' && n.last_heartbeat_at && now - new Date(n.last_heartbeat_at).getTime() > 90000) {
      currentStatus = 'offline';
    }
    return {
      ...n,
      status: currentStatus,
      core_state: n.desired_state === 'active' && currentStatus === 'online' ? 'running' : 'stopped',
      config_status: n.last_apply_error ? 'error' : (n.applied_config_version >= n.desired_config_version ? 'applied' : 'pending'),
      inbounds: allInbounds.filter(s => s.node_id === n.id),
      is_local: false
    };
  }));
});

nodesRoute.post('/api/v1/nodes', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: '主机备注名称不能为空' }, 400);

  const ownerId = currentUser.role === 'admin' && body.owner_id ? Number.parseInt(body.owner_id, 10) : currentUser.userId;
  if (!Number.isInteger(ownerId) || ownerId <= 0) return c.json({ error: '所属租户无效' }, 400);
  const serverIp = typeof body.server_ip === 'string' ? body.server_ip.trim() : '';
  const proxyPort = Number.parseInt(body.proxy_port, 10) || 2096;
  const hopPorts = typeof body.hop_ports === 'string' ? body.hop_ports.trim() : '';
  const protocol = typeof body.protocol === 'string' ? body.protocol.toLowerCase() : 'all';
  const token = generateToken(32);

  let slots: RequestedNodeSlot[];
  if (Array.isArray(body.inbounds)) {
    const normalized = normalizeSlots(body.inbounds, proxyPort, hopPorts);
    if (!normalized) return c.json({ error: '节点插槽参数无效' }, 400);
    slots = normalized;
  } else {
    const defaults = (await c.env.DB.prepare(`SELECT id, protocol FROM inbound_templates WHERE owner_id IS NULL AND is_default = 1 ORDER BY id ASC`).all<{ id: number; protocol: string }>()).results;
    slots = defaults.map(template => ({
      template_id: template.id,
      listen_port: template.protocol === 'vless' ? proxyPort : 2096,
      hop_ports: template.protocol === 'hysteria2' ? hopPorts : '',
      enabled: 1
    }));
  }
  const validation = await validateTemplateBindings(c.env.DB, ownerId, slots);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const result = await c.env.DB.prepare(`
    INSERT INTO nodes (owner_id, name, server_ip, proxy_port, hop_ports, protocol, token, status, desired_state, protocol_version, address_locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 'active', 2, ?)
  `).bind(ownerId, name, serverIp, proxyPort, hopPorts, protocol, token, serverIp ? 1 : 0).run();
  const nodeId = result.meta.last_row_id;
  try {
    await c.env.DB.batch(insertSlotStatements(c.env.DB, nodeId as number, validation.slots));
  } catch (error) {
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(nodeId).run();
    throw error;
  }
  await bumpConfigVersion(c.env.DB);

  return c.json({ id: nodeId, name, token, server_ip: serverIp, proxy_port: proxyPort, hop_ports: hopPorts, protocol, status: 'offline', owner_id: ownerId });
});

nodesRoute.put('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = Number.parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json().catch(() => ({}));
  const node = currentUser.role === 'admin'
    ? await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>()
    : await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND owner_id = ?').bind(id, currentUser.userId).first<any>();
  if (!node) return c.json({ error: '主机不存在或无权限编辑' }, 404);

  const ownerId = currentUser.role === 'admin' && body.owner_id ? Number.parseInt(body.owner_id, 10) : node.owner_id;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : node.name;
  const serverIp = body.server_ip !== undefined ? String(body.server_ip).trim() : node.server_ip;
  const proxyPort = body.proxy_port !== undefined ? Number.parseInt(body.proxy_port, 10) : node.proxy_port;
  const hopPorts = body.hop_ports !== undefined ? String(body.hop_ports).trim() : (node.hop_ports || '');
  const protocol = body.protocol ? String(body.protocol).toLowerCase() : node.protocol;
  const status = body.status ? String(body.status).toLowerCase() : node.status;
  if (!['offline', 'online', 'disabled'].includes(status)) return c.json({ error: '节点状态无效' }, 400);

  let slots: RequestedNodeSlot[];
  if (Array.isArray(body.inbounds)) {
    const normalized = normalizeSlots(body.inbounds, proxyPort, hopPorts);
    if (!normalized) return c.json({ error: '节点插槽参数无效' }, 400);
    slots = normalized;
  } else {
    slots = await existingSlots(c.env.DB, id);
  }
  const validation = await validateTemplateBindings(c.env.DB, ownerId, slots);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const desiredState = status === 'disabled' ? 'disabled' : 'active';
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`
    UPDATE nodes SET owner_id = ?, name = ?, server_ip = ?, proxy_port = ?, hop_ports = ?, protocol = ?, status = ?,
      desired_state = ?, revoked_at = CASE WHEN ? = 'disabled' THEN COALESCE(revoked_at, datetime('now')) ELSE NULL END,
      config_version = config_version + 1, desired_config_version = desired_config_version + 1,
      desired_config_hash = '', address_locked = CASE WHEN TRIM(?) <> '' THEN 1 ELSE address_locked END,
      updated_at = datetime('now') WHERE id = ?
  `).bind(ownerId, name, serverIp, proxyPort, hopPorts, protocol, status, desiredState, status, serverIp, id)];
  statements.push(c.env.DB.prepare('DELETE FROM node_inbounds WHERE node_id = ?').bind(id));
  statements.push(...insertSlotStatements(c.env.DB, id, validation.slots));
  await c.env.DB.batch(statements);
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

nodesRoute.delete('/api/v1/nodes/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = Number.parseInt(c.req.param('id') || '0', 10);
  const where = currentUser.role === 'admin' ? 'id = ?' : 'id = ? AND owner_id = ?';
  const binds = currentUser.role === 'admin' ? [id] : [id, currentUser.userId];
  const result = await c.env.DB.prepare(`
    UPDATE nodes SET status = 'disabled', desired_state = 'revoked', revoked_at = datetime('now'),
      config_version = config_version + 1, desired_config_version = desired_config_version + 1,
      desired_config_hash = '', updated_at = datetime('now') WHERE ${where}
  `).bind(...binds).run();
  if (!result.meta.changes) return c.json({ error: '主机不存在或无权限删除' }, 404);
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});
