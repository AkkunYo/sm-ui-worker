import type { NodeInboundSlot } from '../protocol';

/**
 * 供 VPS 节点心跳同步构建 sing-box 服务端配置使用
 * 严格包含 reality_private_key 用于服务端真实解密
 */
export async function getInboundsForServer(
  db: D1Database,
  nodeId: number
): Promise<NodeInboundSlot[]> {
  const result = await db.prepare(`
    SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
           it.name as template_name, it.protocol,
           it.reality_dest, it.reality_server_name, it.reality_private_key, it.reality_public_key, it.reality_short_id,
           it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
    FROM node_inbounds ni
    JOIN inbound_templates it ON ni.template_id = it.id
    WHERE ni.node_id = ? AND (ni.enabled IS NULL OR ni.enabled = 1)
    ORDER BY ni.listen_port ASC, ni.id ASC
  `).bind(nodeId).all<NodeInboundSlot>();

  return result.results || [];
}

/**
 * 供客户端订阅渲染及 Web 控制台展示使用
 * 严格剔除 reality_private_key，从源头杜绝私钥外泄
 */
export async function getInboundsForSubscription(
  db: D1Database,
  nodeIds: number[]
): Promise<NodeInboundSlot[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => '?').join(',');

  const result = await db.prepare(`
    SELECT ni.id, ni.node_id, ni.template_id, ni.listen_port, ni.hop_ports, ni.enabled,
           it.name as template_name, it.protocol,
           it.reality_dest, it.reality_server_name, it.reality_public_key, it.reality_short_id,
           it.hy2_up_mbps, it.hy2_down_mbps, it.hy2_masquerade
    FROM node_inbounds ni
    JOIN inbound_templates it ON ni.template_id = it.id
    WHERE ni.node_id IN (${placeholders}) AND (ni.enabled IS NULL OR ni.enabled = 1)
    ORDER BY ni.listen_port ASC, ni.id ASC
  `).bind(...nodeIds).all<NodeInboundSlot>();

  return result.results || [];
}
