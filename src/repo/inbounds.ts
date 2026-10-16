import type { NodeInboundSlot } from '../protocol';
import { ensureTenantRealityKeys } from '../lib/tenant-keys';

/** Reality rows (VLESS/Trojan) whose owning tenant has no Reality key pair yet. */
function ownersMissingKeys(slots: NodeInboundSlot[]): number[] {
  return slots
    .filter(slot => (slot.protocol === 'vless' || slot.protocol === 'trojan') && !slot.reality_public_key && slot.owner_id)
    .map(slot => Number(slot.owner_id));
}

/** Run a slot query, lazily provisioning tenant keys once if any are missing. */
async function withTenantKeys(db: D1Database, query: () => Promise<NodeInboundSlot[]>): Promise<NodeInboundSlot[]> {
  const slots = await query();
  const missing = ownersMissingKeys(slots);
  if (missing.length === 0) return slots;
  await ensureTenantRealityKeys(db, missing);
  return query();
}

/**
 * 供 VPS 节点心跳同步构建 sing-box 服务端配置使用
 * 端口、混淆密码和拥塞控制算法直接继承主模板设置
 * Reality 私钥取自节点所属租户，绝不下发其他租户的密钥
 */
export async function getInboundsForServer(
  db: D1Database,
  nodeId: number
): Promise<NodeInboundSlot[]> {
  return withTenantKeys(db, async () => (await db.prepare(`
    SELECT ni.id, ni.node_id, ni.template_id, ni.enabled,
           it.listen_port, it.hy2_obfs_password, it.tuic_congestion_control,
           n.owner_id, it.name as template_name, it.protocol,
           it.reality_dest, it.reality_server_name, owner.reality_private_key, owner.reality_public_key, it.reality_short_id,
           it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
    FROM node_inbounds ni
    JOIN nodes n ON n.id = ni.node_id
    JOIN users owner ON owner.id = n.owner_id
    JOIN inbound_templates it ON ni.template_id = it.id
    WHERE ni.node_id = ?
      AND (ni.enabled IS NULL OR ni.enabled = 1)
    ORDER BY it.listen_port ASC, ni.id ASC
  `).bind(nodeId).all<NodeInboundSlot>()).results || []);
}

/**
 * 供客户端订阅渲染及 Web 控制台展示使用
 * 严格剔除 reality_private_key，从源头杜绝私钥外泄；公钥取自节点所属租户
 */
export async function getInboundsForSubscription(
  db: D1Database,
  nodeIds: number[],
  includeDisabled = false
): Promise<NodeInboundSlot[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => '?').join(',');
  const enabledClause = includeDisabled ? '' : ' AND (ni.enabled IS NULL OR ni.enabled = 1)';

  return withTenantKeys(db, async () => (await db.prepare(`
    SELECT ni.id, ni.node_id, ni.template_id, ni.enabled,
           it.listen_port, it.hy2_obfs_password, it.tuic_congestion_control,
           n.owner_id, it.name as template_name, it.protocol,
           it.reality_dest, it.reality_server_name, owner.reality_public_key, it.reality_short_id,
           it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
    FROM node_inbounds ni
    JOIN nodes n ON n.id = ni.node_id
    JOIN users owner ON owner.id = n.owner_id
    JOIN inbound_templates it ON ni.template_id = it.id
    WHERE ni.node_id IN (${placeholders})${enabledClause}
    ORDER BY it.listen_port ASC, ni.id ASC
  `).bind(...nodeIds).all<NodeInboundSlot>()).results || []);
}
