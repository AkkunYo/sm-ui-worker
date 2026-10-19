import { Hono } from 'hono';
import { generateToken } from '../keys';
import { authMiddleware, adminOnly } from '../middleware/auth';
import type { AppBindings, AppVariables } from '../types';

export const templatesRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

const ALLOWED_PROTOCOLS = ['vless', 'hysteria2', 'tuic', 'trojan', 'anytls'] as const;
type AllowedProtocol = typeof ALLOWED_PROTOCOLS[number];

function defaultPortForProtocol(protocol: AllowedProtocol): number {
  switch (protocol) {
    case 'vless': return 2096;
    case 'hysteria2': return 2096;
    case 'tuic': return 8443;
    case 'trojan': return 443;
    case 'anytls': return 10443;
  }
}

// All authenticated users can view the global master templates list
templatesRoute.get('/api/v1/templates', authMiddleware, async (c) => {
  const templates = (await c.env.DB.prepare(`
    SELECT t.*
    FROM inbound_templates t
    ORDER BY
      t.is_default DESC,
      CASE t.protocol
        WHEN 'vless' THEN 1
        WHEN 'hysteria2' THEN 2
        WHEN 'tuic' THEN 3
        WHEN 'trojan' THEN 4
        WHEN 'anytls' THEN 5
        ELSE 99
      END ASC,
      t.id ASC
  `).all<any>()).results;
  return c.json(templates);
});

// Template mutations strictly restricted to administrator
templatesRoute.post('/api/v1/templates', authMiddleware, adminOnly, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const protocol = (typeof body?.protocol === 'string' ? body.protocol.toLowerCase().trim() : '') as AllowedProtocol;

  if (!name) return c.json({ error: '模板名称不能为空' }, 400);
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    return c.json({ error: `协议类型必须为 ${ALLOWED_PROTOCOLS.join(' / ')}` }, 400);
  }

  const rawPort = Number.parseInt(String(body.listen_port || ''), 10);
  const listenPort = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
    ? rawPort : defaultPortForProtocol(protocol);

  const isDefault = body.is_default ? 1 : 0;
  const realityDest = (body.reality_dest || 'www.amazon.com:443').trim();
  const realityServerName = (body.reality_server_name || 'www.amazon.com').trim();
  const realityShortId = (protocol === 'vless' || protocol === 'trojan')
    ? ((body.reality_short_id || '').trim() || generateToken(16)) : '';

  const hy2UpMbps = parseInt(body.hy2_up_mbps, 10) || 100;
  const hy2DownMbps = parseInt(body.hy2_down_mbps, 10) || 100;
  const hy2Masquerade = (body.hy2_masquerade || 'https://bing.com').trim();

  let hy2ObfsPassword = '';
  if (protocol === 'hysteria2') {
    if (body.hy2_obfs_enabled) {
      hy2ObfsPassword = typeof body.hy2_obfs_password === 'string' && body.hy2_obfs_password.trim()
        ? body.hy2_obfs_password.trim()
        : generateToken(16);
    }
  }

  const tuicCongestion = protocol === 'tuic'
    ? (typeof body.tuic_congestion_control === 'string' && body.tuic_congestion_control.trim() ? body.tuic_congestion_control.trim().toLowerCase() : 'bbr')
    : 'bbr';

  const res = await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      name, protocol, listen_port,
      reality_dest, reality_server_name, reality_short_id,
      hy2_up_mbps, hy2_down_mbps, hy2_masquerade, hy2_obfs_password, tuic_congestion_control,
      is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    name, protocol, listenPort,
    realityDest, realityServerName, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, hy2ObfsPassword, tuicCongestion,
    isDefault
  ).run();

  return c.json({ success: true, id: res.meta.last_row_id });
});

templatesRoute.put('/api/v1/templates/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json().catch(() => ({}));

  const tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  if (!tmpl) return c.json({ error: '模板不存在' }, 404);

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : tmpl.name;
  const rawPort = Number.parseInt(String(body.listen_port || ''), 10);
  const listenPort = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
    ? rawPort : tmpl.listen_port;

  const realityDest = body.reality_dest !== undefined ? body.reality_dest.trim() : tmpl.reality_dest;
  const realityServerName = body.reality_server_name !== undefined ? body.reality_server_name.trim() : tmpl.reality_server_name;
  const realityShortId = body.reality_short_id !== undefined ? body.reality_short_id.trim() : tmpl.reality_short_id;
  const hy2UpMbps = body.hy2_up_mbps !== undefined ? parseInt(body.hy2_up_mbps, 10) : tmpl.hy2_up_mbps;
  const hy2DownMbps = body.hy2_down_mbps !== undefined ? parseInt(body.hy2_down_mbps, 10) : tmpl.hy2_down_mbps;
  const hy2Masquerade = body.hy2_masquerade !== undefined ? body.hy2_masquerade.trim() : tmpl.hy2_masquerade;

  let hy2ObfsPassword = tmpl.hy2_obfs_password || '';
  if (body.hy2_obfs_enabled !== undefined) {
    if (body.hy2_obfs_enabled) {
      hy2ObfsPassword = typeof body.hy2_obfs_password === 'string' && body.hy2_obfs_password.trim()
        ? body.hy2_obfs_password.trim()
        : (hy2ObfsPassword || generateToken(16));
    } else {
      hy2ObfsPassword = '';
    }
  }

  const tuicCongestion = body.tuic_congestion_control !== undefined
    ? String(body.tuic_congestion_control).trim().toLowerCase() : (tmpl.tuic_congestion_control || 'bbr');

  const isDefault = body.is_default !== undefined ? (body.is_default ? 1 : 0) : tmpl.is_default;

  await c.env.DB.prepare(`
    UPDATE inbound_templates SET
      name = ?, listen_port = ?,
      reality_dest = ?, reality_server_name = ?, reality_short_id = ?,
      hy2_up_mbps = ?, hy2_down_mbps = ?, hy2_masquerade = ?, hy2_obfs_password = ?, tuic_congestion_control = ?,
      is_default = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    name, listenPort,
    realityDest, realityServerName, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, hy2ObfsPassword, tuicCongestion,
    isDefault, id
  ).run();

  return c.json({ success: true });
});

templatesRoute.delete('/api/v1/templates/:id', authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param('id') || '0', 10);
  const tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  if (!tmpl) return c.json({ error: '模板不存在' }, 404);

  const inUse = await c.env.DB.prepare('SELECT COUNT(*) as count FROM node_inbounds WHERE template_id = ?').bind(id).first<{ count: number }>();
  if (inUse && inUse.count > 0) {
    return c.json({ error: `该模板当前正被 ${inUse.count} 个主机使用，不可直接删除` }, 400);
  }

  await c.env.DB.prepare('DELETE FROM inbound_templates WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});
