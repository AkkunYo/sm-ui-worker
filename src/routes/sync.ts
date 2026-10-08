import { Hono } from 'hono';
import { buildServerConfig, type NodeRecord, type UserRecord } from '../protocol';
import { getInboundsForServer } from '../repo/inbounds';
import { sha256Hex } from '../lib/crypto';
import { getConfigVersion } from '../lib/config-version';
import type { AppBindings, AppVariables } from '../types';

export const syncRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

syncRoute.post('/api/v1/node/sync', async (c) => {
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
      status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'online' END,
      server_ip = ?,
      last_heartbeat_at = ?,
      rtt_ms = ?,
      cpu_percent = ?,
      memory_percent = ?,
      uptime_seconds = ?,
      core_version = ?,
      agent_version = ?
    WHERE id = ?
  `).bind(
    serverIP,
    now,
    body.rtt_ms || 0,
    body.cpu_percent || 0,
    body.memory_percent || 0,
    body.uptime_seconds || 0,
    body.core_version || 'v1.14.2',
    body.agent_version || '',
    node.id
  ).run();

  // Process traffic reporting deltas: enforce non-negative integers and strict tenant scope
  let nodeDeltaUp = 0;
  let nodeDeltaDown = 0;
  let nodeOwner: { id: number; username: string } | null = null;
  if (Array.isArray(body.traffic_deltas) && body.traffic_deltas.length > 0) {
    nodeOwner = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(node.owner_id).first<{ id: number; username: string }>();
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
    }
  }

  // Atomically update tenant traffic and node physical traffic in a single batch transaction
  if (nodeDeltaUp > 0 || nodeDeltaDown > 0) {
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        UPDATE nodes SET
          used_up_bytes = used_up_bytes + ?,
          used_down_bytes = used_down_bytes + ?
        WHERE id = ?
      `).bind(nodeDeltaUp, nodeDeltaDown, node.id)
    ];

    if (nodeOwner) {
      stmts.push(
        c.env.DB.prepare(`
          UPDATE users SET
            used_up_bytes = used_up_bytes + ?,
            used_down_bytes = used_down_bytes + ?
          WHERE id = ?
        `).bind(nodeDeltaUp, nodeDeltaDown, nodeOwner.id)
      );
    }

    await c.env.DB.batch(stmts);
  }

  // Check if config needs reload via dual-track: hash-based when client reports config_hash, otherwise version-based
  const globalVersion = await getConfigVersion(c.env.DB);
  const clientConfigVersion = body.config_version || 0;
  const clientConfigHash = typeof body.config_hash === 'string' ? body.config_hash.trim() : '';
  const versionBehind = clientConfigVersion < globalVersion || node.config_version < globalVersion;

  // Legacy agent (no hash) that is up to date: skip config generation entirely
  if (!clientConfigHash && !versionBehind) {
    return c.json({ status: 'ok', config_version: globalVersion, reload: false });
  }

  const ownerUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(node.owner_id).first<UserRecord>();
  const slots = await getInboundsForServer(c.env.DB, node.id);

  // STRICT ISOLATION: Node only authorizes its genuine owner user!
  const authUsers: UserRecord[] = ownerUser ? [ownerUser] : [];
  const config = buildServerConfig(node, slots, authUsers);
  const configHash = await sha256Hex(JSON.stringify(config));

  // Hash-driven agents reload only when payload changed; legacy agents reaching here are version-behind
  const shouldReload = clientConfigHash ? clientConfigHash !== configHash : true;

  if (shouldReload) {
    await c.env.DB.prepare('UPDATE nodes SET config_version = ? WHERE id = ?').bind(globalVersion, node.id).run();
    return c.json({
      status: 'ok',
      config_version: globalVersion,
      config_hash: configHash,
      reload: true,
      config
    });
  }

  return c.json({
    status: 'ok',
    config_version: globalVersion,
    config_hash: configHash,
    reload: false
  });
});
