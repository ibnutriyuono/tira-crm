/**
 * Batas waktu & margin yang dipakai pengingat / eskalasi otomatis Operation
 * dan persetujuan diskon Surat Penawaran (SE / BM / GM / VP). Disimpan di tabel Setting (key "opsRules"),
 * diubah Admin di "Pengaturan Batas Waktu & Margin". Client-safe.
 */
export interface OpsRules {
  /** Target waktu jawab RFQ oleh Purchasing (hari) — tampil di Beranda GM Operation. */
  rfqTargetHari: number;
  /** RFQ belum dijawab lebih dari N hari → pengingat ke Purchasing. */
  rfqIngatHari: number;
  /** RFQ belum dijawab lebih dari N hari → eskalasi ke GM Operation. */
  rfqEskalasiHari: number;
  /** Barang lewat target kedatangan lebih dari N hari → GM Operation. */
  telatOpsHari: number;
  /** Barang lewat target kedatangan lebih dari N hari → VP. */
  telatVpHari: number;
  /** Diskon maksimum dari harga jual Purchasing yang boleh diberikan Sales (SE) tanpa persetujuan (%). */
  discSe: number;
  /** Diskon maksimum yang boleh disetujui BM cabang (%). */
  discBm: number;
  /** Diskon maksimum yang boleh disetujui GM (%). */
  discGm: number;
  /** Diskon maksimum yang boleh disetujui VP (%); di atasnya tetap VP, ditandai melewati batas. */
  discVp: number;
  /** Lead Marketing belum ditunjuk Sales lebih dari N hari → pengingat BM. */
  leadTugasHari: number;
  /** Sales sudah ditunjuk tapi belum ada penawaran lebih dari N hari → pengingat Sales (tembusan BM). */
  leadPenawaranHari: number;
  /** Lead belum sampai penawaran lebih dari N hari sejak masuk → eskalasi RM + Marketing pembuatnya. */
  leadEskalasiHari: number;
  /** Saran harga jual dari stok gudang = HPP ÷ (1 − N%) — gross margin, sama seperti margin di jawaban RFQ. */
  stockMarginPct: number;
}

export const DEFAULT_OPS_RULES: OpsRules = {
  rfqTargetHari: 2,
  rfqIngatHari: 2,
  rfqEskalasiHari: 3,
  telatOpsHari: 7,
  telatVpHari: 14,
  discSe: 5,
  discBm: 10,
  discGm: 15,
  discVp: 20,
  leadTugasHari: 1,
  leadPenawaranHari: 3,
  leadEskalasiHari: 5,
  stockMarginPct: 35,
};

export const OPS_RULE_FIELDS: { key: keyof OpsRules; label: string; unit: string; hint: string; min: number; max: number }[] = [
  { key: 'rfqTargetHari', label: 'Target waktu jawab RFQ', unit: 'hari', hint: 'Patokan kinerja Purchasing di Beranda GM Operation.', min: 1, max: 30 },
  { key: 'rfqIngatHari', label: 'Pengingat RFQ belum dijawab', unit: 'hari', hint: 'Lewat batas ini Purchasing diberi pengingat.', min: 1, max: 30 },
  { key: 'rfqEskalasiHari', label: 'Eskalasi RFQ ke GM Operation', unit: 'hari', hint: 'Lewat batas ini GM Operation diberi tahu.', min: 1, max: 60 },
  { key: 'telatOpsHari', label: 'Barang telat → GM Operation', unit: 'hari', hint: 'Hari lewat target kedatangan (PO Indent).', min: 1, max: 90 },
  { key: 'telatVpHari', label: 'Barang telat → VP', unit: 'hari', hint: 'Hari lewat target kedatangan (PO Indent).', min: 1, max: 180 },
  { key: 'leadTugasHari', label: 'Lead belum ditunjuk Sales → BM', unit: 'hari', hint: 'Lead dari Marketing tanpa Sales lewat batas ini: BM diingatkan.', min: 1, max: 30 },
  { key: 'leadPenawaranHari', label: 'Lead belum ada penawaran → Sales', unit: 'hari', hint: 'Sejak Sales ditunjuk; BM ikut diberi tahu.', min: 1, max: 30 },
  { key: 'leadEskalasiHari', label: 'Eskalasi lead ke RM', unit: 'hari', hint: 'Sejak lead masuk belum sampai penawaran: RM & Marketing pembuatnya diberi tahu.', min: 1, max: 60 },
  { key: 'discSe', label: 'Diskon Sales (SE) tanpa persetujuan', unit: '%', hint: 'Diskon dari harga jual Purchasing / saran harga stok sampai batas ini langsung bisa dikirim.', min: 0, max: 100 },
  { key: 'discBm', label: 'Batas diskon BM', unit: '%', hint: 'Diskon sampai batas ini cukup disetujui BM cabang.', min: 0, max: 100 },
  { key: 'discGm', label: 'Batas diskon GM', unit: '%', hint: 'Diskon sampai batas ini cukup disetujui GM.', min: 0, max: 100 },
  { key: 'discVp', label: 'Batas diskon VP', unit: '%', hint: 'Diskon sampai batas ini disetujui VP; di atasnya tetap ke VP dengan tanda melewati batas.', min: 0, max: 100 },
  { key: 'stockMarginPct', label: 'Margin saran harga dari stok', unit: '%', hint: 'Saran harga jual minimal = HPP stok ÷ (1 − margin); 35% → HPP ÷ 0,65. Tampil ke Sales tanpa angka HPP.', min: 0, max: 90 },
];

export function normalizeOpsRules(raw: unknown): OpsRules {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_OPS_RULES };
  OPS_RULE_FIELDS.forEach((f) => {
    const v = Number(src[f.key]);
    if (Number.isFinite(v) && v >= f.min && v <= f.max) out[f.key] = Math.round(v * 10) / 10;
  });
  // Eskalasi tidak boleh lebih cepat dari pengingat / tingkat sebelumnya.
  if (out.rfqEskalasiHari < out.rfqIngatHari) out.rfqEskalasiHari = out.rfqIngatHari;
  if (out.telatVpHari < out.telatOpsHari) out.telatVpHari = out.telatOpsHari;
  if (out.leadEskalasiHari < out.leadTugasHari) out.leadEskalasiHari = out.leadTugasHari;
  // Batas diskon naik bertingkat: SE ≤ BM ≤ GM ≤ VP.
  if (out.discBm < out.discSe) out.discBm = out.discSe;
  if (out.discGm < out.discBm) out.discGm = out.discBm;
  if (out.discVp < out.discGm) out.discVp = out.discGm;
  return out;
}
