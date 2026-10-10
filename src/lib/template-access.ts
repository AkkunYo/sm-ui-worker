export interface RequestedNodeSlot {
  template_id: number;
  listen_port: number;
  hop_ports: string;
  enabled: number;
}

type TemplateOwner = { id: number; owner_id: number | null };

/** Validate every node slot before any node or slot mutation is committed. */
export async function validateTemplateBindings(
  db: D1Database,
  ownerId: number,
  slots: RequestedNodeSlot[]
): Promise<{ ok: true; slots: RequestedNodeSlot[] } | { ok: false; error: string }> {
  if (slots.length === 0) return { ok: true, slots: [] };

  const ids = [...new Set(slots.map(slot => slot.template_id))];
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
    return { ok: false, error: '模板 ID 无效' };
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = (await db.prepare(`SELECT id, owner_id FROM inbound_templates WHERE id IN (${placeholders})`).bind(...ids).all<TemplateOwner>()).results;
  const byId = new Map(rows.map(row => [row.id, row]));

  for (const slot of slots) {
    const template = byId.get(slot.template_id);
    if (!template) return { ok: false, error: `模板 ${slot.template_id} 不存在` };
    if (template.owner_id !== null && template.owner_id !== ownerId) {
      return { ok: false, error: `模板 ${slot.template_id} 不属于当前租户` };
    }
  }

  return { ok: true, slots };
}
