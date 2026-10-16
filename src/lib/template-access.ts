export interface RequestedNodeSlot {
  template_id: number;
  enabled: number;
}

/** Validate every node slot before any node or slot mutation is committed. */
export async function validateTemplateBindings(
  db: D1Database,
  slots: RequestedNodeSlot[]
): Promise<{ ok: true; slots: RequestedNodeSlot[] } | { ok: false; error: string }> {
  if (slots.length === 0) return { ok: true, slots: [] };

  const ids = [...new Set(slots.map(slot => slot.template_id))];
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
    return { ok: false, error: '模板 ID 无效' };
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = (await db.prepare(`SELECT id FROM inbound_templates WHERE id IN (${placeholders})`).bind(...ids).all<{ id: number }>()).results;
  const existingIds = new Set(rows.map(r => r.id));

  for (const slot of slots) {
    if (!existingIds.has(slot.template_id)) {
      return { ok: false, error: `模板 ${slot.template_id} 不存在` };
    }
  }

  return { ok: true, slots };
}
