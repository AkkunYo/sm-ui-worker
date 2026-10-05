export interface InboundTemplateRecord {
  id: number;
  owner_id?: number | null;
  name: string;
  protocol: 'vless' | 'hysteria2';
  reality_dest?: string | null;
  reality_server_name?: string | null;
  reality_private_key?: string | null;
  reality_public_key?: string | null;
  reality_short_id?: string | null;
  hy2_up_mbps?: number | null;
  hy2_down_mbps?: number | null;
  hy2_masquerade?: string | null;
  is_default?: number;
  created_at?: string;
  updated_at?: string;
}

export interface NodeInboundSlot {
  id?: number;
  node_id?: number;
  template_id: number;
  listen_port: number;
  hop_ports?: string | null;
  enabled?: number;
  template_name?: string;
  protocol: 'vless' | 'hysteria2';
  reality_dest?: string | null;
  reality_server_name?: string | null;
  reality_private_key?: string | null;
  reality_public_key?: string | null;
  reality_short_id?: string | null;
  hy2_up_mbps?: number | null;
  hy2_down_mbps?: number | null;
  hy2_masquerade?: string | null;
}

export interface NodeRecord {
  id: number;
  owner_id: number;
  owner_username?: string;
  owner_uuid?: string;
  owner_proxy_password?: string;
  name: string;
  server_ip: string;
  proxy_port?: number;
  hop_ports?: string | null;
  protocol?: string;
  token: string;
  status: string;
  used_up_bytes?: number;
  used_down_bytes?: number;
  inbounds?: NodeInboundSlot[];
}

export interface UserRecord {
  id: number;
  username: string;
  role: string;
  uuid: string;
  proxy_password?: string;
  password?: string;
  sub_token: string;
  status: number;
  traffic_limit_bytes?: number;
  used_up_bytes?: number;
  used_down_bytes?: number;
  expire_at?: string | null;
}

export function isUserActive(u: UserRecord): boolean {
  if (u.status !== 1) return false;
  if (u.expire_at && new Date(u.expire_at) <= new Date()) return false;
  const used = (u.used_up_bytes || 0) + (u.used_down_bytes || 0);
  if (u.traffic_limit_bytes && u.traffic_limit_bytes > 0 && used >= u.traffic_limit_bytes) return false;
  return true;
}

export function buildServerConfig(
  node: NodeRecord,
  inboundSlots: NodeInboundSlot[],
  users: UserRecord[],
  baseDir = '/var/lib/sm-ui'
) {
  const activeUsers = users.filter(isUserActive);
  const activeUserNames = activeUsers.map(u => u.username);

  const vlessUsers = activeUsers.map(u => ({
    uuid: u.uuid,
    flow: 'xtls-rprx-vision',
    name: u.username
  }));

  const hy2Users = activeUsers.map(u => ({
    password: u.proxy_password || u.password || 'sm-ui-password',
    name: u.username
  }));

  const inbounds: any[] = [];
  const inboundTags: string[] = [];

  const enabledSlots = inboundSlots.filter(s => s.enabled === undefined || s.enabled === 1);

  for (let i = 0; i < enabledSlots.length; i++) {
    const slot = enabledSlots[i];
    const tag = `${slot.protocol}-in-${slot.listen_port}-${i + 1}`;
    inboundTags.push(tag);

    if (slot.protocol === 'vless') {
      const serverName = slot.reality_server_name || 'www.amazon.com';
      let destServer = serverName;
      let destPort = 443;
      if (slot.reality_dest && slot.reality_dest.includes(':')) {
        const parts = slot.reality_dest.split(':');
        destServer = parts[0];
        destPort = parseInt(parts[1], 10) || 443;
      }
      const shortIDs = slot.reality_short_id ? [slot.reality_short_id] : ['0123456789abcdef'];

      inbounds.push({
        type: 'vless',
        tag,
        listen: '::',
        listen_port: slot.listen_port,
        users: vlessUsers,
        tls: {
          enabled: true,
          server_name: serverName,
          reality: {
            enabled: true,
            handshake: {
              server: destServer,
              server_port: destPort
            },
            private_key: slot.reality_private_key || '',
            short_id: shortIDs
          }
        }
      });
    } else if (slot.protocol === 'hysteria2') {
      inbounds.push({
        type: 'hysteria2',
        tag,
        listen: '::',
        listen_port: slot.listen_port,
        users: hy2Users,
        up_mbps: slot.hy2_up_mbps || 100,
        down_mbps: slot.hy2_down_mbps || 100,
        ignore_client_bandwidth: false,
        masquerade: slot.hy2_masquerade || 'https://bing.com',
        tls: {
          enabled: true,
          certificate_path: `${baseDir}/certs/selfsigned.crt`,
          key_path: `${baseDir}/certs/selfsigned.key`
        }
      });
    }
  }

  return {
    log: {
      disabled: false,
      level: 'info',
      timestamp: true
    },
    experimental: {
      v2ray_api: {
        listen: '127.0.0.1:8080',
        stats: {
          enabled: true,
          inbounds: inboundTags,
          users: activeUserNames
        }
      }
    },
    inbounds,
    outbounds: [
      {
        type: 'direct',
        tag: 'direct'
      },
      {
        type: 'block',
        tag: 'block'
      }
    ],
    route: {
      rules: [
        {
          inbound: inboundTags,
          outbound: 'direct'
        }
      ]
    }
  };
}

export interface ResolvedEndpoint {
  id: string;
  name: string;
  protocol: 'vless' | 'hysteria2';
  server: string;
  port: number;
  hopPorts?: string;
  isHop?: boolean;
  // VLESS Reality 字段
  uuid?: string;
  flow?: string;
  realityServerName?: string;
  realityPublicKey?: string;
  realityShortId?: string;
  // Hysteria 2 字段
  password?: string;
  sni?: string;
  upMbps?: number;
  downMbps?: number;
  masquerade?: string | null;
}

/**
 * 统一解析并构建节点的标准端点集合
 * 收敛端口后缀命名规则、Hysteria2 SNI 规范化推导以及跳跃端口扩展
 */
export function resolveNodeEndpoints(
  node: NodeRecord,
  slots: NodeInboundSlot[],
  credentials: { uuid: string; proxyPassword?: string },
  tenantSuffix = ''
): ResolvedEndpoint[] {
  if (!node.server_ip) return [];
  const ips = node.server_ip.split(',').map(s => s.trim()).filter(Boolean);
  const targetIP = ips[0] || '';
  if (!targetIP) return [];

  const enabledSlots = (slots || []).filter(s => s.enabled === undefined || s.enabled === 1);
  const endpoints: ResolvedEndpoint[] = [];

  for (const slot of enabledSlots) {
    const portSuffix = slot.listen_port === 2096 ? '' : `:${slot.listen_port}`;

    if (slot.protocol === 'vless') {
      const name = `${node.name}-VLESS-${targetIP}${portSuffix}${tenantSuffix}`;
      endpoints.push({
        id: `${node.id}-vless-${slot.listen_port}`,
        name,
        protocol: 'vless',
        server: targetIP,
        port: slot.listen_port,
        uuid: credentials.uuid,
        flow: 'xtls-rprx-vision',
        realityServerName: slot.reality_server_name || 'www.amazon.com',
        realityPublicKey: slot.reality_public_key || '',
        realityShortId: slot.reality_short_id || '0123456789abcdef'
      });
    } else if (slot.protocol === 'hysteria2') {
      // 统一从 masquerade 解析出干净的 hostname 作为 SNI，fallback 到 reality_server_name 或 IP
      let hy2Sni = slot.reality_server_name || targetIP;
      if (slot.hy2_masquerade) {
        try {
          const u = new URL(slot.hy2_masquerade.startsWith('http') ? slot.hy2_masquerade : `https://${slot.hy2_masquerade}`);
          if (u.hostname) hy2Sni = u.hostname;
        } catch {}
      }

      const upMbps = slot.hy2_up_mbps || 100;
      const downMbps = slot.hy2_down_mbps || 100;
      const password = credentials.proxyPassword || 'sm-ui-password';

      const name = `${node.name}-Hy2-${targetIP}${portSuffix}${tenantSuffix}`;
      endpoints.push({
        id: `${node.id}-hy2-${slot.listen_port}`,
        name,
        protocol: 'hysteria2',
        server: targetIP,
        port: slot.listen_port,
        password,
        sni: hy2Sni,
        upMbps,
        downMbps,
        masquerade: slot.hy2_masquerade
      });

      // Hysteria 2 端口跳跃端点扩展
      if (slot.hop_ports && slot.hop_ports.trim()) {
        const hopPortRange = slot.hop_ports.trim();
        const hopName = `${node.name}-Hy2-Hop-${targetIP}${tenantSuffix}`;
        endpoints.push({
          id: `${node.id}-hy2-hop-${slot.listen_port}`,
          name: hopName,
          protocol: 'hysteria2',
          server: targetIP,
          port: slot.listen_port,
          hopPorts: hopPortRange,
          isHop: true,
          password,
          sni: hy2Sni,
          upMbps,
          downMbps,
          masquerade: slot.hy2_masquerade
        });
      }
    }
  }

  return endpoints;
}

