import { Hono } from 'hono';
import { buildServerConfig, type NodeRecord, type UserRecord } from '../protocol';
import { getInboundsForServer } from '../repo/inbounds';
import { sha256Hex } from '../lib/crypto';
import { PROTOCOL_VERSION } from '../version';
import type { AppBindings, AppVariables } from '../types';

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

interface NormalizedTrafficBatch {
  id: string;
  deltas: any[];
}

/**
 * Settle traffic batches and return their IDs so the agent can drop them.
 * Supports both multi-batch payload (traffic_batches) and legacy single-batch
 * payload (traffic_batch_id + traffic_deltas).
 * Invalid deltas (e.g. the previous tenant's traffic after an owner change)
 * are dropped instead of rejecting the heartbeat: a batch that can never be
 * accepted must not block config delivery forever. A replayed batch ID is
 * settled by its first receipt and never counted twice.
 */
async function settleTraffic(db: D1Database, node: SyncNode, owner: UserRecord | null, body: any): Promise<string[]> {
  const batches: NormalizedTrafficBatch[] = [];
  if (Array.isArray(body?.traffic_batches)) {
    for (const b of body.traffic_batches.slice(0, 16)) {
      const id = typeof b?.id === 'string' ? b.id.trim() : (typeof b?.traffic_batch_id === 'string' ? b.traffic_batch_id.trim() : '');
      const deltas = Array.isArray(b?.deltas) ? b.deltas : (Array.isArray(b?.traffic_deltas) ? b.traffic_deltas : []);
      if (id && id.length <= 128) {
        batches.push({ id, deltas });
      }
    }
  } else if (typeof body?.traffic_batch_id === 'string' && body.traffic_batch_id.trim()) {
    const id = body.traffic_batch_id.trim();
    if (id.length <= 128) {
      const deltas = Array.isArray(body.traffic_deltas) ? body.traffic_deltas : [];
      batches.push({ id, deltas });
    }
  }

  if (batches.length === 0) return [];
  if (!owner) return batches.map(b => b.id);

  const acceptedIds: string[] = [];
  const dbStatements: D1PreparedStatement[] = [];

  for (const batch of batches) {
    let up = 0;
    let down = 0;
    for (const delta of batch.deltas.slice(0, MAX_TRAFFIC_DELTAS)) {
      const username = typeof delta?.username === 'string' ? delta.username.trim() : '';
      const deltaUp = Number(delta?.uplink);
      const deltaDown = Number(delta?.downlink);
      const validBytes = [deltaUp, deltaDown].every(v => Number.isSafeInteger(v) && v >= 0 && v <= MAX_DELTA_BYTES);
      if (username !== owner.username || !validBytes) {
        console.warn('[sync] dropped traffic delta', { node: node.id, batch: batch.id, username });
        continue;
      }
      up += deltaUp;
      down += deltaDown;
    }

    acceptedIds.push(batch.id);

    if (up === 0 && down === 0) continue;

    const existing = await db.prepare('SELECT uplink_bytes, downlink_bytes FROM traffic_receipts WHERE node_id = ? AND batch_id = ?')
      .bind(node.id, batch.id).first<{ uplink_bytes: number; downlink_bytes: number }>();
    if (existing) {
      if (existing.uplink_bytes !== up || existing.downlink_bytes !== down) {
        console.warn('[sync] traffic batch replayed with different totals; first receipt kept', { node: node.id, batch: batch.id });
      }
      continue;
    }

    dbStatements.push(
      db.prepare('INSERT OR IGNORE INTO traffic_receipts (node_id, batch_id, uplink_bytes, downlink_bytes) VALUES (?, ?, ?, ?)')
        .bind(node.id, batch.id, up, down),
      db.prepare('UPDATE nodes SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
        .bind(up, down, node.id),
      db.prepare('UPDATE users SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
        .bind(up, down, owner.id)
    );
  }

  if (dbStatements.length > 0) {
    await db.batch(dbStatements);
  }

  // Opportunistic cleanup of stale receipts older than 3 days (non-blocking)
  db.prepare("DELETE FROM traffic_receipts WHERE received_at < datetime('now', '-3 days')")
    .run()
    .catch(() => {});

  return acceptedIds;
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
  const certSha256 = typeof body.cert_sha256 === 'string' ? body.cert_sha256.trim().slice(0, 64).toLowerCase() : '';

  await c.env.DB.prepare(`
    UPDATE nodes SET
      status = ?, server_ip = CASE WHEN TRIM(COALESCE(server_ip, '')) = '' AND ? <> '' THEN ? ELSE server_ip END,
      address_locked = CASE WHEN TRIM(COALESCE(server_ip, '')) = '' AND ? <> '' THEN 1 ELSE address_locked END,
      cert_sha256 = CASE WHEN ? <> '' THEN ? ELSE cert_sha256 END,
      last_heartbeat_at = ?, rtt_ms = ?, cpu_percent = ?, memory_percent = ?, uptime_seconds = ?,
      core_version = ?, agent_version = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    reportedStatus,
    serverIP, serverIP,
    serverIP,
    certSha256, certSha256,
    now,
    Number.isFinite(Number(body.rtt_ms)) ? Number(body.rtt_ms) : 0,
    Number.isFinite(Number(body.cpu_percent)) ? Number(body.cpu_percent) : 0,
    Number.isFinite(Number(body.memory_percent)) ? Number(body.memory_percent) : 0,
    Number.isFinite(Number(body.uptime_seconds)) ? Number(body.uptime_seconds) : 0,
    typeof body.core_version === 'string' ? body.core_version.slice(0, 64) : 'unknown',
    typeof body.agent_version === 'string' ? body.agent_version.slice(0, 64) : '',
    node.id
  ).run();

  const owner = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(node.owner_id).first<UserRecord>();
  const acceptedTrafficBatchIds = await settleTraffic(c.env.DB, node, owner, body);
  const acceptedTrafficBatchId = acceptedTrafficBatchIds[0] || '';

  if (node.desired_state !== 'active') {
    return c.json({
      protocol_version: PROTOCOL_VERSION,
      status: 'ok',
      desired_state: node.desired_state === 'revoked' ? 'revoked' : 'disabled',
      config_version: Number(node.desired_config_version) || 1,
      accepted_traffic_batch_id: acceptedTrafficBatchId,
      accepted_traffic_batch_ids: acceptedTrafficBatchIds,
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
    accepted_traffic_batch_ids: acceptedTrafficBatchIds,
    reload: shouldReload,
    ...(shouldReload ? { config } : {})
  });
});
