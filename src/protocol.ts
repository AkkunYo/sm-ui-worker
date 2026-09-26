export interface NodeRecord {
  id: number;
  owner_id: number;
  name: string;
  server_ip: string;
  proxy_port: number;
  hop_ports?: string;
  protocol: string; // 'all' | 'vless' | 'hysteria2'
  token: string;
  status: string;
}

export interface InboundTemplateRecord {
  id: number;
  owner_id?: number | null;
  reality_dest: string;
  reality_server_name: string;
  reality_private_key: string;
  reality_public_key: string;
  reality_short_id: string;
  hy2_up_mbps: number;
  hy2_down_mbps: number;
  hy2_masquerade: string;
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
}

export function buildServerConfig(
  node: NodeRecord,
  template: InboundTemplateRecord,
  users: UserRecord[],
  baseDir = '/var/lib/sm-ui'
) {
  const activeUsers = users.filter(u => u.status === 1);
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

  const shortIDs = template.reality_short_id ? [template.reality_short_id] : ['0123456789abcdef'];

  let destServer = template.reality_server_name;
  let destPort = 443;
  if (template.reality_dest.includes(':')) {
    const parts = template.reality_dest.split(':');
    destServer = parts[0];
    destPort = parseInt(parts[1], 10) || 443;
  }

  const inbounds: any[] = [];
  const proto = (node.protocol || 'all').toLowerCase();

  // 1. VLESS Reality Inbound (TCP)
  if (proto === 'all' || proto === 'vless') {
    inbounds.push({
      type: 'vless',
      tag: 'vless-in',
      listen: '::',
      listen_port: node.proxy_port,
      users: vlessUsers,
      tls: {
        enabled: true,
        server_name: template.reality_server_name,
        reality: {
          enabled: true,
          handshake: {
            server: destServer,
            server_port: destPort
          },
          private_key: template.reality_private_key,
          short_id: shortIDs
        }
      }
    });
  }

  // 2. Hysteria 2 Inbound (UDP)
  if (proto === 'all' || proto === 'hysteria2') {
    inbounds.push({
      type: 'hysteria2',
      tag: 'hy2-in',
      listen: '::',
      listen_port: node.proxy_port,
      users: hy2Users,
      up_mbps: template.hy2_up_mbps || 100,
      down_mbps: template.hy2_down_mbps || 100,
      ignore_client_bandwidth: false,
      masquerade: template.hy2_masquerade || 'https://bing.com',
      tls: {
        enabled: true,
        certificate_path: `${baseDir}/certs/selfsigned.crt`,
        key_path: `${baseDir}/certs/selfsigned.key`
      }
    });
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
          inbounds: ['vless-in', 'hy2-in'],
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
          inbound: ['vless-in', 'hy2-in'],
          outbound: 'direct'
        }
      ]
    }
  };
}
