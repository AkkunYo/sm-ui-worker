import { Hono } from 'hono';
import { generateToken } from '../keys';
import { getInboundsForSubscription } from '../repo/inbounds';
import { bumpConfigVersion } from '../lib/config-version';
import { authMiddleware } from '../middleware/auth';
import type { AppBindings, AppVariables, JwtUser } from '../types';

export const nodesRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

nodesRoute.get('/api/v1/nodes', authMiddleware, async (c) => {
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
  const allInbounds = await getInboundsForSubscription(c.env.DB, nodeIds, true);

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

nodesRoute.post('/api/v1/nodes', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: '主机备注名称不能为空' }, 400);

  let ownerId: number = currentUser.userId;
  if (currentUser.role === 'admin' && body.owner_id) {
    ownerId = parseInt(body.owner_id, 10);
  }

  const serverIp = (body.server_ip || '').trim();
  const proxyPort = parseInt(body.proxy_port, 10) || 2096;
  const hopPorts = (body.hop_ports || '').trim();
  const protocol = (body.protocol || 'all').toLowerCase();
  const token = generateToken(32);

  const res = await c.env.DB.prepare(`
    INSERT INTO nodes (owner_id, name, server_ip, proxy_port, hop_ports, protocol, token, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')
  `).bind(ownerId, name, serverIp, proxyPort, hopPorts, protocol, token).run();

  const nodeId = res.meta.last_row_id;

  // Insert slots into node_inbounds if provided
  if (nodeId && Array.isArray(body.inbounds) && body.inbounds.length > 0) {
    const stmts: D1PreparedStatement[] = [];
    for (const slot of body.inbounds) {
      if (slot.template_id) {
        stmts.push(
          c.env.DB.prepare(`
            INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            nodeId,
            parseInt(slot.template_id, 10),
            parseInt(slot.listen_port, 10) || 2096,
            (slot.hop_ports || '').trim(),
            slot.enabled !== undefined ? (slot.enabled ? 1 : 0) : 1
          )
        );
      }
    }
    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }
  } else if (nodeId) {
    // Auto-bind default public templates for quick zero-conf start
    const defaults = (await c.env.DB.prepare(`
      SELECT id, protocol FROM inbound_templates WHERE owner_id IS NULL AND is_default = 1
    `).all<{ id: number; protocol: string }>()).results;

    const stmts = defaults.map(tmpl =>
      c.env.DB.prepare(`
        INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).bind(
        nodeId,
        tmpl.id,
        tmpl.protocol === 'vless' ? proxyPort : 2096,
        tmpl.protocol === 'hysteria2' ? hopPorts : ''
      )
    );
    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }
  }

  await bumpConfigVersion(c.env.DB);

  return c.json({
    id: nodeId,
    name,
    token,
    server_ip: serverIp,
    proxy_port: proxyPort,
    hop_ports: hopPorts,
    protocol,
    status: 'offline',
    owner_id: ownerId
  });
});

nodesRoute.put('/api/v1/nodes/:id', authMiddleware, async (c) => {
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

  // If inbounds slots provided, update them atomically in a batch transaction
  if (Array.isArray(body.inbounds)) {
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare('DELETE FROM node_inbounds WHERE node_id = ?').bind(id)
    ];
    for (const slot of body.inbounds) {
      if (slot.template_id) {
        stmts.push(
          c.env.DB.prepare(`
            INSERT INTO node_inbounds (node_id, template_id, listen_port, hop_ports, enabled)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            id,
            parseInt(slot.template_id, 10),
            parseInt(slot.listen_port, 10) || proxyPort,
            (slot.hop_ports || '').trim(),
            slot.enabled !== undefined ? (slot.enabled ? 1 : 0) : 1
          )
        );
      }
    }
    await c.env.DB.batch(stmts);
  }

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

nodesRoute.delete('/api/v1/nodes/:id', authMiddleware, async (c) => {
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
