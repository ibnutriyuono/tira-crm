/**
 * The optional "form material seragam" fields stored inside a material /
 * RFQ item JSON (see lib/material-spec.ts). Kept dependency-free so both the
 * server sanitizers and lib/format.ts can use it without an import cycle.
 */
const DIM_KEYS = ['dia', 'tebal', 'lebar', 'panjang', 'sisi', 'od', 'h', 'b', 't1', 't2'] as const;
const str = (v: unknown, max = 200) => String(v ?? '').slice(0, max);

/** Copies only the known spec fields, as plain strings/booleans/numbers. */
export function pickSpecExtra(m: unknown): Record<string, unknown> {
  if (!m || typeof m !== 'object') return {};
  const o = m as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (o.grade !== undefined) out.grade = str(o.grade, 60);
  if (o.bentuk !== undefined) out.bentuk = str(o.bentuk, 40);
  if (o.dim && typeof o.dim === 'object') {
    const d: Record<string, string> = {};
    DIM_KEYS.forEach((k) => {
      const v = (o.dim as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && String(v) !== '') d[k] = str(v, 20);
    });
    out.dim = d;
  }
  if (typeof o.beratPcAuto === 'boolean') out.beratPcAuto = o.beratPcAuto;
  if (typeof o.uraianAuto === 'boolean') out.uraianAuto = o.uraianAuto;
  if (o.fabNama !== undefined) out.fabNama = str(o.fabNama);
  if (o.noGambar !== undefined) out.noGambar = str(o.noGambar, 80);
  if (o.satuan !== undefined) out.satuan = str(o.satuan, 20);
  if (o.hargaUnit !== undefined) {
    const n = Number(o.hargaUnit);
    if (Number.isFinite(n)) out.hargaUnit = n;
  }
  // Alur item prospek (lib/item-flow.ts): id baris tetap + qty PO / terkirim.
  if (typeof o.itemId === 'string' && o.itemId) out.itemId = o.itemId.slice(0, 40);
  for (const k of ['qtyPo', 'qtyKirim'] as const) {
    const n = typeof o[k] === 'number' ? (o[k] as number) : NaN;
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  if (o.beratPc !== undefined && o.uraian === undefined) {
    // RFQ / FUP A items carry berat per pc next to the total `berat`.
    const n = Number(o.beratPc);
    if (Number.isFinite(n) && n > 0) out.beratPc = n;
  }
  return out;
}
