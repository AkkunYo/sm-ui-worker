import { stringify } from 'yaml';
import { resolveNodeEndpoints, type NodeRecord, type ResolvedEndpoint, type UserRecord } from './protocol';

/**
 * 序列化为 Clash/Mihomo/Stash 代理对象
 */
function toClashProxy(ep: ResolvedEndpoint) {
  if (ep.protocol === 'vless') {
    return {
      name: ep.name,
      type: 'vless',
      server: ep.server,
      port: ep.port,
      uuid: ep.uuid,
      network: 'tcp',
      tls: true,
      'reality-opts': {
        'public-key': ep.realityPublicKey || '',
        'short-id': ep.realityShortId || '0123456789abcdef'
      },
      servername: ep.realityServerName || 'www.amazon.com',
      'client-fingerprint': 'chrome',
      flow: ep.flow || 'xtls-rprx-vision'
    };
  }

  // hysteria2
  const base: any = {
    name: ep.name,
    type: 'hysteria2',
    server: ep.server,
    port: ep.port,
    password: ep.password,
    sni: ep.sni,
    'skip-cert-verify': true,
    up: `${ep.upMbps || 100} Mbps`,
    down: `${ep.downMbps || 100} Mbps`
  };

  if (ep.isHop && ep.hopPorts) {
    base.ports = ep.hopPorts;
  }

  return base;
}

/**
 * 序列化为 Sing-box 出站对象
 */
function toSingBoxOutbound(ep: ResolvedEndpoint) {
  if (ep.protocol === 'vless') {
    return {
      type: 'vless',
      tag: ep.name,
      server: ep.server,
      server_port: ep.port,
      uuid: ep.uuid,
      flow: ep.flow || 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: ep.realityServerName || 'www.amazon.com',
        utls: { enabled: true, fingerprint: 'chrome' },
        reality: {
          enabled: true,
          public_key: ep.realityPublicKey || '',
          short_id: ep.realityShortId || '0123456789abcdef'
        }
      }
    };
  }

  // hysteria2 (排除端口跳跃单列出站，保持 sing-box 纯净连接；SNI 统一取规范化 ep.sni)
  return {
    type: 'hysteria2',
    tag: ep.name,
    server: ep.server,
    server_port: ep.port,
    password: ep.password,
    tls: {
      enabled: true,
      server_name: ep.sni || ep.server,
      insecure: true
    }
  };
}

/**
 * 序列化为标准协议 URI 字符串
 */
export function toUriString(ep: ResolvedEndpoint): string {
  const remark = encodeURIComponent(ep.name);

  if (ep.protocol === 'vless') {
    return `vless://${ep.uuid}@${ep.server}:${ep.port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${encodeURIComponent(ep.realityServerName || 'www.amazon.com')}&fp=chrome&pbk=${encodeURIComponent(ep.realityPublicKey || '')}&sid=${encodeURIComponent(ep.realityShortId || '0123456789abcdef')}&type=tcp&headerType=none#${remark}`;
  }

  // hysteria2
  if (ep.isHop && ep.hopPorts) {
    return `hysteria2://${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.hopPorts}?alpn=h3&insecure=1&allowInsecure=1&mport=${encodeURIComponent(ep.hopPorts)}&sni=${encodeURIComponent(ep.sni || ep.server)}&upmbps=${ep.upMbps || 100}&downmbps=${ep.downMbps || 100}#${remark}`;
  }

  return `hysteria2://${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.port}?alpn=h3&insecure=1&allowInsecure=1&sni=${encodeURIComponent(ep.sni || ep.server)}&upmbps=${ep.upMbps || 100}&downmbps=${ep.downMbps || 100}#${remark}`;
}

export function buildSubscription(
  user: UserRecord & { used_up_bytes: number; used_down_bytes: number; traffic_limit_bytes: number; expire_at?: string | null },
  nodes: NodeRecord[],
  userAgent: string
): { contentType: string; body: string; headers: Record<string, string> } {
  const ua = (userAgent || '').toLowerCase();

  // 严格过滤仅包含在线或非禁用且具有 IP 的节点
  const activeNodes = nodes.filter(n => n.status !== 'disabled' && n.server_ip);

  // 响应头流量及限额提示
  const subHeaders: Record<string, string> = {
    'Profile-Update-Interval': '12',
    'Subscription-Userinfo': `upload=${user.used_up_bytes || 0}; download=${user.used_down_bytes || 0}; total=${user.traffic_limit_bytes || 0}; expire=${user.expire_at ? Math.floor(new Date(user.expire_at).getTime() / 1000) : 0}`
  };

  // 集中解析所有节点的标准端点集合
  const allEndpoints: ResolvedEndpoint[] = [];
  for (const node of activeNodes) {
    const tenantSuffix = node.owner_username ? ` [${node.owner_username}]` : '';
    const creds = {
      uuid: node.owner_uuid || user.uuid,
      proxyPassword: node.owner_proxy_password || user.proxy_password || user.password || ''
    };
    const eps = resolveNodeEndpoints(node, node.inbounds || [], creds, tenantSuffix);
    allEndpoints.push(...eps);
  }

  // 1. Mihomo / Clash format
  if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')) {
    const proxies = allEndpoints.map(toClashProxy);
    const proxyNames = proxies.map(p => p.name);
    const fallbackList = proxyNames.length > 0 ? proxyNames : ['DIRECT'];

    const clashConfig = {
      port: 7890,
      'socks-port': 7891,
      'allow-lan': true,
      mode: 'rule',
      'log-level': 'info',
      proxies,
      'proxy-groups': [
        {
          name: 'PROXIES',
          type: 'select',
          proxies: ['AUTO', ...proxyNames]
        },
        {
          name: 'AUTO',
          type: 'url-test',
          proxies: fallbackList,
          url: 'http://cp.cloudflare.com/generate_204',
          interval: 300
        }
      ],
      rules: [
        'DST-PORT,22,DIRECT',
        'GEOIP,LAN,DIRECT',
        'GEOIP,CN,DIRECT',
        'MATCH,PROXIES'
      ]
    };

    return {
      contentType: 'text/yaml; charset=utf-8',
      body: stringify(clashConfig),
      headers: subHeaders
    };
  }

  // 2. Sing-box JSON format
  if (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa') || ua.includes('sfm')) {
    // 排除 hop 端口避免 sing-box 客户端解析异常，保持稳定主连接
    const singboxEndpoints = allEndpoints.filter(ep => !ep.isHop);
    const outbounds = singboxEndpoints.map(toSingBoxOutbound);
    const outboundTags = outbounds.map(o => o.tag);

    const sbConfig = {
      outbounds: [
        {
          type: 'selector',
          tag: 'select',
          outbounds: ['auto', ...outboundTags]
        },
        {
          type: 'urltest',
          tag: 'auto',
          outbounds: outboundTags.length > 0 ? outboundTags : ['direct'],
          url: 'http://cp.cloudflare.com/generate_204',
          interval: '3m'
        },
        ...outbounds,
        { type: 'direct', tag: 'direct' }
      ]
    };

    return {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(sbConfig, null, 2),
      headers: subHeaders
    };
  }

  // 3. Default: Universal Base64 URI list
  const uris = allEndpoints.map(toUriString);

  return {
    contentType: 'text/plain; charset=utf-8',
    body: btoa(uris.join('\n')),
    headers: subHeaders
  };
}
