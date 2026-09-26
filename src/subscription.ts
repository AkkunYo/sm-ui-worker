import { stringify } from 'yaml';
import type { NodeRecord, InboundTemplateRecord, UserRecord } from './protocol';

export function buildSubscription(
  user: UserRecord & { used_up_bytes: number; used_down_bytes: number; traffic_limit_bytes: number; expire_at?: string },
  nodes: NodeRecord[],
  template: InboundTemplateRecord,
  userAgent: string
): { contentType: string; body: string; headers: Record<string, string> } {
  const ua = (userAgent || '').toLowerCase();

  const activeNodes = nodes.filter(n => n.status === 'online' && n.server_ip);

  // Headers for client traffic display
  const subHeaders: Record<string, string> = {
    'Profile-Update-Interval': '12',
    'Subscription-Userinfo': `upload=${user.used_up_bytes || 0}; download=${user.used_down_bytes || 0}; total=${user.traffic_limit_bytes || 0}; expire=${user.expire_at ? Math.floor(new Date(user.expire_at).getTime() / 1000) : 0}`
  };

  // 1. Mihomo / Clash format
  if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')) {
    const proxies: any[] = [];
    const proxyNames: string[] = [];

    for (const node of activeNodes) {
      const ips = node.server_ip.split(',').map(s => s.trim()).filter(Boolean);
      const targetIP = ips[0] || '127.0.0.1';
      const proto = (node.protocol || 'all').toLowerCase();
      const suffix = node.owner_username ? ` [${node.owner_username}]` : '';
      const nodeUuid = node.owner_uuid || user.uuid;
      const nodePassword = node.owner_proxy_password || user.proxy_password || user.password || '';

      // VLESS Reality
      if (proto === 'all' || proto === 'vless') {
        const name = `${node.name}-VLESS-${targetIP}${suffix}`;
        proxies.push({
          name,
          type: 'vless',
          server: targetIP,
          port: node.proxy_port,
          uuid: nodeUuid,
          network: 'tcp',
          tls: true,
          'reality-opts': {
            'public-key': template.reality_public_key,
            'short-id': template.reality_short_id || '0123456789abcdef'
          },
          servername: template.reality_server_name,
          'client-fingerprint': 'chrome',
          flow: 'xtls-rprx-vision'
        });
        proxyNames.push(name);
      }

      // Hysteria 2
      if (proto === 'all' || proto === 'hysteria2') {
        let hy2Sni = template.reality_server_name || targetIP;
        if (template.hy2_masquerade) {
          try {
            const u = new URL(template.hy2_masquerade.startsWith('http') ? template.hy2_masquerade : `https://${template.hy2_masquerade}`);
            if (u.hostname) hy2Sni = u.hostname;
          } catch {}
        }
        const name = `${node.name}-Hy2-${targetIP}${suffix}`;
        proxies.push({
          name,
          type: 'hysteria2',
          server: targetIP,
          port: node.proxy_port,
          password: nodePassword,
          sni: hy2Sni,
          'skip-cert-verify': true,
          up: `${template.hy2_up_mbps || 100} Mbps`,
          down: `${template.hy2_down_mbps || 100} Mbps`
        });
        proxyNames.push(name);

        // Port Hopping in Clash
        if (node.hop_ports && node.hop_ports.trim()) {
          const hopName = `${node.name}-Hy2-Hop-${targetIP}${suffix}`;
          proxies.push({
            name: hopName,
            type: 'hysteria2',
            server: targetIP,
            port: node.proxy_port,
            ports: node.hop_ports.trim(),
            password: nodePassword,
            sni: hy2Sni,
            'skip-cert-verify': true,
            up: `${template.hy2_up_mbps || 100} Mbps`,
            down: `${template.hy2_down_mbps || 100} Mbps`
          });
          proxyNames.push(hopName);
        }
      }
    }

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
    const outbounds: any[] = [];
    const outboundTags: string[] = [];

    for (const node of activeNodes) {
      const ips = node.server_ip.split(',').map(s => s.trim()).filter(Boolean);
      const targetIP = ips[0] || '127.0.0.1';
      const proto = (node.protocol || 'all').toLowerCase();
      const suffix = node.owner_username ? ` [${node.owner_username}]` : '';
      const nodeUuid = node.owner_uuid || user.uuid;
      const nodePassword = node.owner_proxy_password || user.proxy_password || user.password || '';

      // VLESS Reality
      if (proto === 'all' || proto === 'vless') {
        const tag = `${node.name}-VLESS-${targetIP}${suffix}`;
        outbounds.push({
          type: 'vless',
          tag,
          server: targetIP,
          server_port: node.proxy_port,
          uuid: nodeUuid,
          flow: 'xtls-rprx-vision',
          tls: {
            enabled: true,
            server_name: template.reality_server_name,
            utls: { enabled: true, fingerprint: 'chrome' },
            reality: {
              enabled: true,
              public_key: template.reality_public_key,
              short_id: template.reality_short_id || '0123456789abcdef'
            }
          }
        });
        outboundTags.push(tag);
      }

      // Hysteria 2
      if (proto === 'all' || proto === 'hysteria2') {
        const tag = `${node.name}-Hy2-${targetIP}${suffix}`;
        outbounds.push({
          type: 'hysteria2',
          tag,
          server: targetIP,
          server_port: node.proxy_port,
          password: nodePassword,
          tls: {
            enabled: true,
            server_name: template.reality_server_name,
            insecure: true
          }
        });
        outboundTags.push(tag);
      }
    }

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
  const uris: string[] = [];
  for (const node of activeNodes) {
    const ips = node.server_ip.split(',').map(s => s.trim()).filter(Boolean);
    const targetIP = ips[0] || '127.0.0.1';
    const proto = (node.protocol || 'all').toLowerCase();
    const suffix = node.owner_username ? ` [${node.owner_username}]` : '';
    const nodeUuid = node.owner_uuid || user.uuid;
    const nodePassword = node.owner_proxy_password || user.proxy_password || user.password || '';

    // VLESS Reality URI
    if (proto === 'all' || proto === 'vless') {
      const remark = encodeURIComponent(`${node.name}-VLESS-${targetIP}${suffix}`);
      const vlessURI = `vless://${nodeUuid}@${targetIP}:${node.proxy_port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${encodeURIComponent(template.reality_server_name)}&fp=chrome&pbk=${encodeURIComponent(template.reality_public_key)}&sid=${encodeURIComponent(template.reality_short_id || '0123456789abcdef')}&type=tcp&headerType=none#${remark}`;
      uris.push(vlessURI);
    }

    // Hysteria 2 URI
    if (proto === 'all' || proto === 'hysteria2') {
      const remark = encodeURIComponent(`${node.name}-Hy2-${targetIP}${suffix}`);
      let hy2Sni = template.reality_server_name || targetIP;
      if (template.hy2_masquerade) {
        try {
          const u = new URL(template.hy2_masquerade.startsWith('http') ? template.hy2_masquerade : `https://${template.hy2_masquerade}`);
          if (u.hostname) hy2Sni = u.hostname;
        } catch {}
      }
      const upMbps = template.hy2_up_mbps || 100;
      const downMbps = template.hy2_down_mbps || 100;
      const hy2URI = `hysteria2://${encodeURIComponent(nodePassword)}@${targetIP}:${node.proxy_port}?alpn=h3&insecure=1&allowInsecure=1&sni=${encodeURIComponent(hy2Sni)}&upmbps=${upMbps}&downmbps=${downMbps}#${remark}`;
      uris.push(hy2URI);

      // Hysteria 2 Port Hopping URI
      if (node.hop_ports && node.hop_ports.trim()) {
        const hopRemark = encodeURIComponent(`${node.name}-Hy2-Hop-${targetIP}${suffix}`);
        const hopPortRange = node.hop_ports.trim();
        const hopURI = `hysteria2://${encodeURIComponent(nodePassword)}@${targetIP}:${hopPortRange}?alpn=h3&insecure=1&allowInsecure=1&mport=${encodeURIComponent(hopPortRange)}&sni=${encodeURIComponent(hy2Sni)}&upmbps=${upMbps}&downmbps=${downMbps}#${hopRemark}`;
        uris.push(hopURI);
      }
    }
  }

  const plainList = uris.join('\n');
  const base64Body = btoa(unescape(encodeURIComponent(plainList)));

  return {
    contentType: 'text/plain; charset=utf-8',
    body: base64Body,
    headers: subHeaders
  };
}
