import { stringify } from 'yaml';
import type { ResolvedEndpoint, UserRecord } from './protocol';

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

  if (ep.protocol === 'trojan') {
    return {
      name: ep.name,
      type: 'trojan',
      server: ep.server,
      port: ep.port,
      password: ep.password,
      network: 'tcp',
      tls: true,
      'reality-opts': {
        'public-key': ep.realityPublicKey || '',
        'short-id': ep.realityShortId || '0123456789abcdef'
      },
      servername: ep.realityServerName || 'www.amazon.com',
      'client-fingerprint': 'chrome'
    };
  }

  // mihomo 设了 fingerprint 就只按证书哈希校验（与 skip-cert-verify 无关）；
  // 不认识该字段的客户端则维持原有的 skip-cert-verify 行为
  const pin = ep.certSha256 ? { fingerprint: ep.certSha256 } : {};

  if (ep.protocol === 'tuic') {
    return {
      name: ep.name,
      type: 'tuic',
      server: ep.server,
      port: ep.port,
      uuid: ep.uuid,
      password: ep.password,
      alpn: ['h3'],
      'congestion-controller': ep.tuicCongestionControl || 'bbr',
      'skip-cert-verify': true,
      sni: ep.sni || ep.server,
      ...pin
    };
  }

  if (ep.protocol === 'anytls') {
    return {
      name: ep.name,
      type: 'anytls',
      server: ep.server,
      port: ep.port,
      password: ep.password,
      sni: ep.sni || ep.server,
      'skip-cert-verify': true,
      udp: true,
      ...pin
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
    down: `${ep.downMbps || 100} Mbps`,
    ...pin
  };

  if (ep.hy2ObfsPassword) {
    base.obfs = 'salamander';
    base['obfs-password'] = ep.hy2ObfsPassword;
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

  if (ep.protocol === 'trojan') {
    return {
      type: 'trojan',
      tag: ep.name,
      server: ep.server,
      server_port: ep.port,
      password: ep.password,
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

  if (ep.protocol === 'tuic') {
    return {
      type: 'tuic',
      tag: ep.name,
      server: ep.server,
      server_port: ep.port,
      uuid: ep.uuid,
      password: ep.password,
      congestion_control: ep.tuicCongestionControl || 'bbr',
      tls: {
        enabled: true,
        server_name: ep.sni || ep.server,
        insecure: true,
        alpn: ['h3']
      }
    };
  }

  if (ep.protocol === 'anytls') {
    return {
      type: 'anytls',
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

  // hysteria2
  const outbound: Record<string, unknown> = {
    type: 'hysteria2',
    tag: ep.name,
    server: ep.server,
    password: ep.password,
    tls: {
      enabled: true,
      server_name: ep.sni || ep.server,
      insecure: true
    }
  };
  if (ep.hy2ObfsPassword) {
    outbound.obfs = {
      type: 'salamander',
      password: ep.hy2ObfsPassword
    };
  }
  outbound.server_port = ep.port;
  return outbound;
}

/**
 * 自签证书 URI 校验参数：有证书哈希时用 pinSHA256（hysteria2）/ pcs（Xray）锁定，
 * 并去掉新版 Xray 已拒绝的 allowInsecure；insecure=1 保留给 hysteria2 跳过 CA 校验，
 * 其锁定检查照常执行
 */
function uriCertParams(ep: ResolvedEndpoint): string {
  if (!ep.certSha256) return '&insecure=1&allowInsecure=1';
  const pin = encodeURIComponent(ep.certSha256);
  return `&insecure=1&pinSHA256=${pin}&pcs=${pin}`;
}

/**
 * 序列化为标准协议 URI 字符串
 */
export function toUriString(ep: ResolvedEndpoint): string {
  const remark = encodeURIComponent(ep.name);

  if (ep.protocol === 'vless') {
    return `vless://${ep.uuid}@${ep.server}:${ep.port}?encryption=none&flow=${encodeURIComponent(ep.flow || 'xtls-rprx-vision')}&security=reality&sni=${encodeURIComponent(ep.realityServerName || 'www.amazon.com')}&fp=chrome&pbk=${encodeURIComponent(ep.realityPublicKey || '')}&sid=${encodeURIComponent(ep.realityShortId || '0123456789abcdef')}&type=tcp&headerType=none#${remark}`;
  }

  if (ep.protocol === 'trojan') {
    return `trojan://${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.port}?security=reality&sni=${encodeURIComponent(ep.realityServerName || 'www.amazon.com')}&fp=chrome&pbk=${encodeURIComponent(ep.realityPublicKey || '')}&sid=${encodeURIComponent(ep.realityShortId || '0123456789abcdef')}&type=tcp#${remark}`;
  }

  if (ep.protocol === 'tuic') {
    return `tuic://${ep.uuid}:${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.port}?alpn=h3&congestion_control=${encodeURIComponent(ep.tuicCongestionControl || 'bbr')}${uriCertParams(ep)}&sni=${encodeURIComponent(ep.sni || ep.server)}#${remark}`;
  }

  if (ep.protocol === 'anytls') {
    return `anytls://${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.port}?insecure=1&allowInsecure=1&sni=${encodeURIComponent(ep.sni || ep.server)}#${remark}`;
  }

  // hysteria2
  const obfsParams = ep.hy2ObfsPassword
    ? `&obfs=salamander&obfs-password=${encodeURIComponent(ep.hy2ObfsPassword)}`
    : '';

  return `hysteria2://${encodeURIComponent(ep.password || '')}@${ep.server}:${ep.port}?alpn=h3${uriCertParams(ep)}&sni=${encodeURIComponent(ep.sni || ep.server)}&upmbps=${ep.upMbps || 100}&downmbps=${ep.downMbps || 100}${obfsParams}#${remark}`;
}

export function buildSubscription(
  user: UserRecord & { used_up_bytes: number; used_down_bytes: number; traffic_limit_bytes: number; expire_at?: string | null },
  allEndpoints: ResolvedEndpoint[],
  userAgent: string,
  requestedFormat = ''
): { contentType: string; body: string; headers: Record<string, string> } {
  const ua = (userAgent || '').toLowerCase();
  const format = requestedFormat.toLowerCase().trim();

  // 响应头流量及限额提示
  const subHeaders: Record<string, string> = {
    'Profile-Update-Interval': '12',
    'Subscription-Userinfo': `upload=${user.used_up_bytes || 0}; download=${user.used_down_bytes || 0}; total=${user.traffic_limit_bytes || 0}; expire=${user.expire_at ? Math.floor(new Date(user.expire_at).getTime() / 1000) : 0}`
  };

  // 1. Mihomo / Clash format
  if (format === 'clash' || (!format && (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')))) {
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
  if (format === 'singbox' || (!format && (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa') || ua.includes('sfm')))) {
    const outbounds = allEndpoints.map(toSingBoxOutbound);
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

  // 3. Explicit base64 or default universal URI list
  const uris = allEndpoints.map(toUriString);

  return {
    contentType: 'text/plain; charset=utf-8',
    body: btoa(uris.join('\n')),
    headers: subHeaders
  };
}
