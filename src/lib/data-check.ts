import type { TrendRow } from './material-trend';

/**
 * "Cek data" tab Product: item yang angkanya janggal sehingga tonase, Rp/kg
 * atau nilai PO di analisa ikut melenceng. Hanya menandai — perbaikan tetap
 * lewat Edit Prospek.
 */

export type CekKind = 'berat0' | 'beratUkuran' | 'rpkgRendah' | 'rpkgTinggi' | 'rpkgGrade' | 'hargaPo0';

export const CEK_LABEL: Record<CekKind, string> = {
  berat0: 'Berat/pcs kosong',
  beratUkuran: 'Berat/pcs beda jauh dari ukuran',
  rpkgRendah: 'Rp/kg terlalu rendah',
  rpkgTinggi: 'Rp/kg terlalu tinggi',
  rpkgGrade: 'Rp/kg jauh dari grade',
  hargaPo0: 'Harga kosong (sudah PO)',
};

/** Batas wajar harga jual baja per kg (rupiah). */
export const RPKG_MIN = 5000;
export const RPKG_MAX = 500000;

export interface CekRow {
  row: TrendRow;
  kinds: CekKind[];
  /** Penjelasan singkat per masalah, urut sama dengan kinds. */
  notes: string[];
  rpKg: number;
  /** Tonase ditawarkan / PO item ini (kg) — ukuran dampak ke analisa. */
  kg: number;
  nilaiPo: number;
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const kgT = (n: number) => `${Math.round(n).toLocaleString('id-ID')} kg`;

function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `rows`: baris trend yang sudah disaring cabang & periode (ditawarkan / PO di periode). */
export function cekData(rows: TrendRow[]): CekRow[] {
  const items = rows.filter((r) => !r.fab && (r.offQty > 0 || r.poQty > 0));
  const rpkgOf = (r: TrendRow) => (r.kgPc > 0 && r.unitPrice > 0 ? r.unitPrice / r.kgPc : 0);

  // Median Rp/kg per grade dari item yang angkanya masih di rentang wajar.
  const byGrade = new Map<string, number[]>();
  items.forEach((r) => {
    const v = rpkgOf(r);
    if (v >= RPKG_MIN && v <= RPKG_MAX && !r.gradeKey.startsWith('~')) byGrade.set(r.gradeKey, [...(byGrade.get(r.gradeKey) || []), v]);
  });
  const med = new Map<string, number>();
  byGrade.forEach((l, k) => l.length >= 4 && med.set(k, median(l)));

  const out: CekRow[] = [];
  items.forEach((r) => {
    const kinds: CekKind[] = [];
    const notes: string[] = [];
    const qty = r.poQty || r.offQty;
    const v = rpkgOf(r);
    if (!(r.kgPc > 0)) {
      kinds.push('berat0');
      notes.push('tonase item ini tidak terhitung (0 kg)');
    } else if (r.kgTyped > 0 && r.kgAuto > 0) {
      const ratio = r.kgTyped / r.kgAuto;
      if (ratio > 2.5 || ratio < 0.4) {
        kinds.push('beratUkuran');
        notes.push(`diisi ${kgT(r.kgTyped)}/pcs, hitungan ukuran ${kgT(r.kgAuto)}/pcs`);
      }
    }
    if (v > 0 && v < RPKG_MIN) {
      kinds.push('rpkgRendah');
      notes.push(`${rp(v)}/kg (di bawah ${rp(RPKG_MIN)})`);
    } else if (v > RPKG_MAX) {
      kinds.push('rpkgTinggi');
      notes.push(`${rp(v)}/kg (di atas ${rp(RPKG_MAX)})`);
    } else if (v > 0 && med.has(r.gradeKey)) {
      const m = med.get(r.gradeKey)!;
      if (v < m * 0.4 || v > m * 2.5) {
        kinds.push('rpkgGrade');
        notes.push(`${rp(v)}/kg, umumnya ${r.grade} ${rp(m)}/kg`);
      }
    }
    if (r.poQty > 0 && !(r.unitPrice > 0)) {
      kinds.push('hargaPo0');
      notes.push('nilai PO item ini Rp 0');
    }
    if (!kinds.length) return;
    out.push({ row: r, kinds, notes, rpKg: v, kg: qty * r.kgPc, nilaiPo: r.poQty * r.unitPrice });
  });
  // Yang paling menggeser angka analisa di atas.
  return out.sort((a, b) => b.kg - a.kg || b.nilaiPo - a.nilaiPo);
}
