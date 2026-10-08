import { Hono } from 'hono';
import { generateRealityKeyPair, generateToken } from '../keys';
import { bumpConfigVersion } from '../lib/config-version';
import { authMiddleware, adminOnly } from '../middleware/auth';
import type { AppBindings, AppVariables, JwtUser } from '../types';

export const templatesRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

templatesRoute.get('/api/v1/templates', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  let templates: any[] = [];
  if (currentUser.role === 'admin') {
    templates = (await c.env.DB.prepare(`
      SELECT t.*, u.username as owner_username
      FROM inbound_templates t
      LEFT JOIN users u ON t.owner_id = u.id
      ORDER BY t.owner_id ASC, t.protocol ASC, t.id ASC
    `).all<any>()).results;
  } else {
    templates = (await c.env.DB.prepare(`
      SELECT t.*
      FROM inbound_templates t
      WHERE t.owner_id IS NULL OR t.owner_id = ?
      ORDER BY t.owner_id ASC, t.protocol ASC, t.id ASC
    `).bind(currentUser.userId).all<any>()).results;

    // Strip private keys for system templates or templates not owned by this tenant
    templates = templates.map(t => {
      if (t.owner_id === null || t.owner_id !== currentUser.userId) {
        return { ...t, reality_private_key: '' };
      }
      return t;
    });
  }
  return c.json(templates);
});

templatesRoute.post('/api/v1/templates', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const body = await c.req.json();
  const name = (body.name || '').trim();
  const protocol = (body.protocol || '').toLowerCase();

  if (!name) return c.json({ error: '模板名称不能为空' }, 400);
  if (protocol !== 'vless' && protocol !== 'hysteria2') {
    return c.json({ error: '协议类型必须为 vless 或 hysteria2' }, 400);
  }

  let ownerId: number | null = currentUser.userId;
  if (currentUser.role === 'admin' && body.is_system === true) {
    ownerId = null; // System-wide public template
  }

  const isDefault = (currentUser.role === 'admin' && body.is_default) ? 1 : 0;
  const realityDest = (body.reality_dest || 'www.amazon.com:443').trim();
  const realityServerName = (body.reality_server_name || 'www.amazon.com').trim();
  const realityPrivateKey = (body.reality_private_key || '').trim();
  const realityPublicKey = (body.reality_public_key || '').trim();
  const realityShortId = (body.reality_short_id || '').trim();

  if (protocol === 'vless' && (!realityPrivateKey || !realityPublicKey)) {
    return c.json({ error: 'VLESS Reality 必须提供 Private Key 和 Public Key' }, 400);
  }

  const hy2UpMbps = parseInt(body.hy2_up_mbps, 10) || 100;
  const hy2DownMbps = parseInt(body.hy2_down_mbps, 10) || 100;
  const hy2Masquerade = (body.hy2_masquerade || 'https://bing.com').trim();

  const res = await c.env.DB.prepare(`
    INSERT INTO inbound_templates (
      owner_id, name, protocol, reality_dest, reality_server_name,
      reality_private_key, reality_public_key, reality_short_id,
      hy2_up_mbps, hy2_down_mbps, hy2_masquerade, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ownerId, name, protocol, realityDest, realityServerName,
    realityPrivateKey, realityPublicKey, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, isDefault
  ).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true, id: res.meta.last_row_id });
});

templatesRoute.put('/api/v1/templates/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);
  const body = await c.req.json();

  let tmpl: any = null;
  if (currentUser.role === 'admin') {
    tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  } else {
    tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ? AND owner_id = ?').bind(id, currentUser.userId).first<any>();
  }
  if (!tmpl) return c.json({ error: '模板不存在或无权限修改' }, 404);

  const name = body.name ? body.name.trim() : tmpl.name;
  const realityDest = body.reality_dest !== undefined ? body.reality_dest.trim() : tmpl.reality_dest;
  const realityServerName = body.reality_server_name !== undefined ? body.reality_server_name.trim() : tmpl.reality_server_name;
  const realityPrivateKey = body.reality_private_key !== undefined ? body.reality_private_key.trim() : tmpl.reality_private_key;
  const realityPublicKey = body.reality_public_key !== undefined ? body.reality_public_key.trim() : tmpl.reality_public_key;
  const realityShortId = body.reality_short_id !== undefined ? body.reality_short_id.trim() : tmpl.reality_short_id;
  const hy2UpMbps = body.hy2_up_mbps !== undefined ? parseInt(body.hy2_up_mbps, 10) : tmpl.hy2_up_mbps;
  const hy2DownMbps = body.hy2_down_mbps !== undefined ? parseInt(body.hy2_down_mbps, 10) : tmpl.hy2_down_mbps;
  const hy2Masquerade = body.hy2_masquerade !== undefined ? body.hy2_masquerade.trim() : tmpl.hy2_masquerade;
  const isDefault = (currentUser.role === 'admin' && body.is_default !== undefined) ? (body.is_default ? 1 : 0) : tmpl.is_default;

  await c.env.DB.prepare(`
    UPDATE inbound_templates SET
      name = ?, reality_dest = ?, reality_server_name = ?,
      reality_private_key = ?, reality_public_key = ?, reality_short_id = ?,
      hy2_up_mbps = ?, hy2_down_mbps = ?, hy2_masquerade = ?, is_default = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    name, realityDest, realityServerName,
    realityPrivateKey, realityPublicKey, realityShortId,
    hy2UpMbps, hy2DownMbps, hy2Masquerade, isDefault,
    id
  ).run();

  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

templatesRoute.delete('/api/v1/templates/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user') as JwtUser;
  const id = parseInt(c.req.param('id') || '0', 10);

  let tmpl: any = null;
  if (currentUser.role === 'admin') {
    tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ?').bind(id).first<any>();
  } else {
    tmpl = await c.env.DB.prepare('SELECT * FROM inbound_templates WHERE id = ? AND owner_id = ?').bind(id, currentUser.userId).first<any>();
  }
  if (!tmpl) return c.json({ error: '模板不存在或无权限删除' }, 404);

  // Check if template is referenced in node_inbounds
  const inUse = await c.env.DB.prepare('SELECT COUNT(*) as count FROM node_inbounds WHERE template_id = ?').bind(id).first<{ count: number }>();
  if (inUse && inUse.count > 0) {
    return c.json({ error: `该模板当前正被 ${inUse.count} 个主机插槽使用，不可直接删除` }, 400);
  }

  await c.env.DB.prepare('DELETE FROM inbound_templates WHERE id = ?').bind(id).run();
  await bumpConfigVersion(c.env.DB);
  return c.json({ success: true });
});

templatesRoute.get('/api/v1/template/generate-keys', authMiddleware, async (c) => {
  const keys = generateRealityKeyPair();
  const shortId = generateToken(16);
  return c.json({
    reality_private_key: keys.privateKey,
    reality_public_key: keys.publicKey,
    reality_short_id: shortId
  });
});
