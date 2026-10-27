/**
 * Batas waktu & margin yang dipakai pengingat / eskalasi otomatis Operation
 * dan persetujuan margin VP. Disimpan di tabel Setting (key "opsRules"),
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
  /** Margin minimum Surat Penawaran (%) — di bawahnya perlu persetujuan VP. */
  marginMin: number;
}

export const DEFAULT_OPS_RULES: OpsRules = {
  rfqTargetHari: 2,
  rfqIngatHari: 2,
  rfqEskalasiHari: 3,
  telatOpsHari: 7,
  telatVpHari: 14,
  marginMin: 15,
};

export const OPS_RULE_FIELDS: { key: keyof OpsRules; label: string; unit: string; hint: string; min: number; max: number }[] = [
  { key: 'rfqTargetHari', label: 'Target waktu jawab RFQ', unit: 'hari', hint: 'Patokan kinerja Purchasing di Beranda GM Operation.', min: 1, max: 30 },
  { key: 'rfqIngatHari', label: 'Pengingat RFQ belum dijawab', unit: 'hari', hint: 'Lewat batas ini Purchasing diberi pengingat.', min: 1, max: 30 },
  { key: 'rfqEskalasiHari', label: 'Eskalasi RFQ ke GM Operation', unit: 'hari', hint: 'Lewat batas ini GM Operation diberi tahu.', min: 1, max: 60 },
  { key: 'telatOpsHari', label: 'Barang telat → GM Operation', unit: 'hari', hint: 'Hari lewat target kedatangan (PO Indent).', min: 1, max: 90 },
  { key: 'telatVpHari', label: 'Barang telat → VP', unit: 'hari', hint: 'Hari lewat target kedatangan (PO Indent).', min: 1, max: 180 },
  { key: 'marginMin', label: 'Margin minimum Surat Penawaran', unit: '%', hint: 'Harga surat di bawah HPP + margin ini perlu persetujuan VP.', min: 0, max: 100 },
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
  return out;
}
