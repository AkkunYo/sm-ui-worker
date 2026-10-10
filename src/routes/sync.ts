import { Hono } from 'hono';
import { buildServerConfig, type NodeRecord, type UserRecord } from '../protocol';
import { getInboundsForServer } from '../repo/inbounds';
import { sha256Hex } from '../lib/crypto';
import { getConfigVersion } from '../lib/config-version';
import type { AppBindings, AppVariables } from '../types';

const PROTOCOL_VERSION = 2;
const MAX_DELTA_BYTES = 500 * 1024 * 1024 * 1024;
const MAX_TRAFFIC_DELTAS = 256;

export const syncRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

syncRoute.post('/api/v2/node/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.protocol_version !== PROTOCOL_VERSION) {
    return c.json({ error: 'Agent protocol upgrade required', required_protocol_version: PROTOCOL_VERSION }, 426);
  }
  const token = c.req.header('X-Node-Token');
  if (!token || token.length > 256) return c.json({ error: 'Missing X-Node-Token' }, 401);

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE token = ?').bind(token).first<NodeRecord & {
    config_version: number;
    owner_id: number;
    desired_state: string;
    desired_config_version: number;
    desired_config_hash: string;
    applied_config_version: number;
    applied_config_hash: string;
    address_locked: number;
  }>();
  if (!node) return c.json({ error: 'Invalid node token' }, 401);

  const now = new Date().toISOString();
  const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  const serverIP = node.server_ip || (!node.address_locked ? clientIP : '');
  const requestedStatus = typeof body.status === 'string' ? body.status : 'offline';
  const reportedStatus = node.desired_state === 'active' && ['online', 'offline'].includes(requestedStatus) ? requestedStatus : 'disabled';
  const appliedVersion = Number.isSafeInteger(body.applied_config_version) && body.applied_config_version >= 0
    ? body.applied_config_version : 0;
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

  let acceptedTrafficBatchId = '';
  const batchId = typeof body.traffic_batch_id === 'string' ? body.traffic_batch_id.trim() : '';
  if (batchId && batchId.length <= 128 && Array.isArray(body.traffic_deltas) && body.traffic_deltas.length <= MAX_TRAFFIC_DELTAS) {
    const owner = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(node.owner_id).first<{ id: number; username: string }>();
    let nodeDeltaUp = 0;
    let nodeDeltaDown = 0;
    if (owner) {
      for (const delta of body.traffic_deltas) {
        const username = typeof delta?.username === 'string' ? delta.username.trim() : '';
        const up = Number(delta?.uplink);
        const down = Number(delta?.downlink);
        if (username !== owner.username || !Number.isSafeInteger(up) || !Number.isSafeInteger(down) || up < 0 || down < 0 || up > MAX_DELTA_BYTES || down > MAX_DELTA_BYTES) {
          return c.json({ error: '流量批次无效' }, 400);
        }
        nodeDeltaUp += up;
        nodeDeltaDown += down;
      }
      if (!Number.isSafeInteger(nodeDeltaUp) || !Number.isSafeInteger(nodeDeltaDown)) {
        return c.json({ error: '流量批次过大' }, 400);
      }
      const existingReceipt = await c.env.DB.prepare('SELECT uplink_bytes, downlink_bytes FROM traffic_receipts WHERE node_id = ? AND batch_id = ?').bind(node.id, batchId).first<{ uplink_bytes: number; downlink_bytes: number }>();
      if (existingReceipt && (existingReceipt.uplink_bytes !== nodeDeltaUp || existingReceipt.downlink_bytes !== nodeDeltaDown)) {
        return c.json({ error: '流量批次内容与已接收记录不一致' }, 409);
      }
      if (!existingReceipt) {
        const receiptBatch = await c.env.DB.batch([
          c.env.DB.prepare(`INSERT OR IGNORE INTO traffic_receipts (node_id, batch_id, uplink_bytes, downlink_bytes) VALUES (?, ?, ?, ?)`)
            .bind(node.id, batchId, nodeDeltaUp, nodeDeltaDown),
          c.env.DB.prepare('UPDATE nodes SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
            .bind(nodeDeltaUp, nodeDeltaDown, node.id),
          c.env.DB.prepare('UPDATE users SET used_up_bytes = used_up_bytes + ?, used_down_bytes = used_down_bytes + ? WHERE id = ? AND changes() = 1')
            .bind(nodeDeltaUp, nodeDeltaDown, owner.id)
        ]);
        if (!receiptBatch[0]?.meta?.changes) {
          const racedReceipt = await c.env.DB.prepare('SELECT uplink_bytes, downlink_bytes FROM traffic_receipts WHERE node_id = ? AND batch_id = ?').bind(node.id, batchId).first<{ uplink_bytes: number; downlink_bytes: number }>();
          if (!racedReceipt) return c.json({ error: '流量批次重复提交，请重试' }, 409);
          if (racedReceipt.uplink_bytes !== nodeDeltaUp || racedReceipt.downlink_bytes !== nodeDeltaDown) {
            return c.json({ error: '流量批次内容与已接收记录不一致' }, 409);
          }
        }
      }
      acceptedTrafficBatchId = batchId;
    }
  }

  const globalVersion = await getConfigVersion(c.env.DB);
  const desiredVersion = Math.max(globalVersion, Number(node.desired_config_version || node.config_version || 1));
  if (node.desired_state !== 'active') {
    return c.json({
      protocol_version: PROTOCOL_VERSION,
      status: 'ok',
      desired_state: node.desired_state === 'revoked' ? 'revoked' : 'disabled',
      config_version: desiredVersion,
      accepted_traffic_batch_id: acceptedTrafficBatchId,
      reload: false
    });
  }

  const ownerUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND status = 1').bind(node.owner_id).first<UserRecord>();
  const slots = await getInboundsForServer(c.env.DB, node.id);
  const config = buildServerConfig(node, slots, ownerUser ? [ownerUser] : []);
  const configHash = await sha256Hex(JSON.stringify(config));
  await c.env.DB.prepare(`
    UPDATE nodes SET desired_config_version = ?, desired_config_hash = ? WHERE id = ?
  `).bind(desiredVersion, configHash, node.id).run();

  const acknowledged = !applyError && appliedVersion >= desiredVersion && appliedHash === configHash;
  if (acknowledged) {
    await c.env.DB.prepare('UPDATE nodes SET applied_config_version = ?, applied_config_hash = ?, last_apply_error = ? WHERE id = ?')
      .bind(appliedVersion, appliedHash, '', node.id).run();
  } else if (applyError) {
    await c.env.DB.prepare('UPDATE nodes SET last_apply_error = ? WHERE id = ?').bind(applyError, node.id).run();
  }
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
