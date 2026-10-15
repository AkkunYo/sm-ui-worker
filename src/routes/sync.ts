import { Hono } from 'hono';
import { buildServerConfig, type NodeRecord, type UserRecord } from '../protocol';
import { getInboundsForServer } from '../repo/inbounds';
import { sha256Hex } from '../lib/crypto';
import type { AppBindings, AppVariables } from '../types';

const PROTOCOL_VERSION = 2;
const MAX_DELTA_BYTES = 500 * 1024 * 1024 * 1024;
const MAX_TRAFFIC_DELTAS = 256;

type SyncNode = NodeRecord & {
  owner_id: number;
  desired_state: string;
  desired_config_version: number;
  desired_config_hash: string;
  applied_config_version: number;
  applied_config_hash: string;
  last_apply_error: string;
  address_locked: number;
};

export const syncRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

/**
 * Settle one traffic batch and return its ID so the agent can drop it.
 * Invalid deltas (e.g. the previous tenant's traffic after an owner change)
 * are dropped instead of rejecting the heartbeat: a batch that can never be
 * accepted must not block config delivery forever. A replayed batch ID is
 * settled by its first receipt and never counted twice.
 */
async function settleTraffic(db: D1Database, node: SyncNode, owner: UserRecord | null, body: any): Promise<string> {
  const batchId = typeof body.traffic_batch_id === 'string' ? body.traffic_batch_id.trim() : '';
  if (!batchId || batchId.length > 128) return '';
  if (!owner) return batchId;
  const deltas: any[] = Array.isArray(body.traffic_deltas) ? body.traffic_deltas.slice(0, MAX_TRAFFIC_DELTAS) : [];

  let up = 0;
  let down = 0;
  for (const delta of deltas) {
    const username = typeof delta?.username === 'string' ? delta.username.trim() : '';
    const deltaUp = Number(delta?.uplink);
    const deltaDown = Number(delta?.downlink);
    const validBytes = [deltaUp, deltaDown].every(v => Number.isSafeInteger(v) && v >= 0 && v <= MAX_DELTA_BYTES);
    if (username !== owner.username || !validBytes) {
      console.warn('[sync] dropped traffic delta', { node: node.id, batch: batchId, username });
      continue;
    }
    up += deltaUp;
    down += deltaDown;
  }
  if (up === 0 && down === 0) return batchId;

  const existing = await db.prepare('SELECT uplink_bytes, downlink_bytes FROM traffic_receipts WHERE node_id = ? AND batch_id = ?')
    .bind(node.id, batchId).first<{ uplink_bytes: number; downlink_bytes: number }>();
  if (existing) {
    if (existing.uplink_bytes !== up || existing.downlink_bytes !== down) {
      console.warn('[sync] traffic batch replayed with different totals; first receipt kept', { node: node.id, batch: batchId });
    }
    return batchId;
  }
  // Receipt and both counters commit in one batch; the changes() chain turns
  // a concurrent duplicate insert into a no-op for the counters as well.
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO traffic_receipts (node_id, batch_id, uplink_bytes, downlink_bytes) VALUES (?, ?, ?, ?)')
      .bind(node.id, batchId, up, down),
    db.prepare('UPDATE nodes SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
      .bind(up, down, node.id),
    db.prepare('UPDATE users SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
      .bind(up, down, owner.id)
  ]);
  return batchId;
}

syncRoute.post('/api/v2/node/sync', async (c) => {
  const parsed = await c.req.json().catch(() => null);
  const body: any = parsed && typeof parsed === 'object' ? parsed : {};
  if (body.protocol_version !== PROTOCOL_VERSION) {
    return c.json({ error: 'Agent protocol upgrade required', required_protocol_version: PROTOCOL_VERSION }, 426);
  }
  const token = c.req.header('X-Node-Token');
  if (!token || token.length > 256) return c.json({ error: 'Missing X-Node-Token' }, 401);

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE token = ?').bind(token).first<SyncNode>();
  if (!node) return c.json({ error: 'Invalid node token' }, 401);

  const now = new Date().toISOString();
  const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  const serverIP = node.server_ip || (!node.address_locked ? clientIP : '');
  const requestedStatus = typeof body.status === 'string' ? body.status : 'offline';
  const reportedStatus = node.desired_state === 'active' && ['online', 'offline'].includes(requestedStatus) ? requestedStatus : 'disabled';
  const appliedHash = typeof body.applied_config_hash === 'string' ? body.applied_config_hash.trim().slice(0, 128) : '';
  const applyError = typeof body.apply_error === 'string' ? body.apply_error.slice(0, 1000) : '';

  await c.env.DB.prepare(`
    UPDATE nodes SET
      status = ?, server_ip = CASE WHEN TRIM(COALESCE(server_ip, '')) = '' AND ? <> '' THEN ? ELSE server_ip END,
      address_locked = CASE WHEN TRIM(COALESCE(server_ip, '')) = '' AND ? <> '' THEN 1 ELSE address_locked END,
      last_heartbeat_at = ?, rtt_ms = ?, cpu_percent = ?, memory_percent = ?, uptime_seconds = ?,
      core_version = ?, agent_version = ?, protocol_version = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    reportedStatus,
    serverIP, serverIP,
    serverIP,
    now,
    Number.isFinite(Number(body.rtt_ms)) ? Number(body.rtt_ms) : 0,
    Number.isFinite(Number(body.cpu_percent)) ? Number(body.cpu_percent) : 0,
    Number.isFinite(Number(body.memory_percent)) ? Number(body.memory_percent) : 0,
    Number.isFinite(Number(body.uptime_seconds)) ? Number(body.uptime_seconds) : 0,
    typeof body.core_version === 'string' ? body.core_version.slice(0, 64) : 'unknown',
    typeof body.agent_version === 'string' ? body.agent_version.slice(0, 64) : '',
    PROTOCOL_VERSION,
    node.id
  ).run();

  const owner = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(node.owner_id).first<UserRecord>();
  const acceptedTrafficBatchId = await settleTraffic(c.env.DB, node, owner, body);

  if (node.desired_state !== 'active') {
    return c.json({
      protocol_version: PROTOCOL_VERSION,
      status: 'ok',
      desired_state: node.desired_state === 'revoked' ? 'revoked' : 'disabled',
      config_version: Number(node.desired_config_version) || 1,
      accepted_traffic_batch_id: acceptedTrafficBatchId,
      reload: false
    });
  }

  const slots = await getInboundsForServer(c.env.DB, node.id);
  const config = buildServerConfig(node, slots, owner ? [owner] : []);
  const configHash = await sha256Hex(JSON.stringify(config));

  // Only this node's own config content decides reloads. The revision number
  // advances when the hash changes and is informational (logs/UI) only.
  const configChanged = configHash !== node.desired_config_hash;
  const desiredVersion = (Number(node.desired_config_version) || 0) + (configChanged ? 1 : 0);
  const acknowledged = !applyError && appliedHash === configHash;

  // Write only what changed, so a steady-state heartbeat costs one write.
  const updates: D1PreparedStatement[] = [];
  if (configChanged) {
    updates.push(c.env.DB.prepare('UPDATE nodes SET desired_config_version = ?, desired_config_hash = ? WHERE id = ?')
      .bind(desiredVersion, configHash, node.id));
  }
  if (acknowledged && (node.applied_config_hash !== configHash || node.last_apply_error || Number(node.applied_config_version) !== desiredVersion)) {
    updates.push(c.env.DB.prepare("UPDATE nodes SET applied_config_version = ?, applied_config_hash = ?, last_apply_error = '' WHERE id = ?")
      .bind(desiredVersion, configHash, node.id));
  } else if (applyError && applyError !== node.last_apply_error) {
    updates.push(c.env.DB.prepare('UPDATE nodes SET last_apply_error = ? WHERE id = ?').bind(applyError, node.id));
  }
  if (updates.length > 0) await c.env.DB.batch(updates);

  const shouldReload = !acknowledged;
  return c.json({
    protocol_version: PROTOCOL_VERSION,
    status: 'ok',
    desired_state: 'active',
    config_version: desiredVersion,
    config_hash: configHash,
    accepted_traffic_batch_id: acceptedTrafficBatchId,
    reload: shouldReload,
    ...(shouldReload ? { config } : {})
  });
});
