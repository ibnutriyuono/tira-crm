'use client';

import { formatDateID, formatRupiah } from '@/lib/format';
import { STATE_META, fmtQty, type Kontrak, type KontrakState } from '@/lib/kontrak';
import { MARGIN_LEVEL_LABEL, asLevel } from '@/lib/margin-tier';
import { useT } from '@/store/useLangStore';

export function StateBadge({ state }: { state: KontrakState }) {
  const tr = useT();
  const m = STATE_META[state];
  return <span className={`badge ${m.color}`}>{tr(m.label)}</span>;
}

export const rp = (n: number | null | undefined) => (n == null ? '-' : formatRupiah(Math.round(n)));
export const rpKg = (n: number | null | undefined, satuan = 'kg') => (n == null ? '-' : `${formatRupiah(Math.round(n))}/${satuan}`);
export const pct = (n: number | null | undefined) => (n == null ? '-' : `${String(Math.round(n * 10) / 10).replace('.', ',')}%`);
export const tgl = (s: string | null | undefined) => formatDateID(s || null);
export { fmtQty };

/** Komitmen & realisasi seluruh kontrak (hanya item ber-satuan sama yang dijumlah). */
export function totals(k: Kontrak) {
  const kgItems = k.items.filter((i) => i.satuan === 'kg');
  const kom = kgItems.reduce((s, i) => s + (i.qtyKomitmen || 0), 0);
  const pakaiPo = kgItems.reduce((s, i) => s + (k.real?.[i.id]?.pakai || 0), 0);
  const saldo = kgItems.reduce((s, i) => s + (i.saldoQty || 0), 0);
  const nilai = k.items.reduce((s, i) => s + (k.real?.[i.id]?.nilai || 0) + (i.saldoNilai || 0), 0);
  return { kom, pakai: pakaiPo + saldo, pakaiPo, saldo, nilai, otherUnits: k.items.length - kgItems.length };
}

export function levelLabel(level: string | null | undefined): string {
  if (!level) return 'tanpa persetujuan';
  if (level === 'gmops') return 'GM Operation';
  return MARGIN_LEVEL_LABEL[asLevel(level)];
}

/** Bar progres dengan penanda posisi waktu. */
export function ProgBar({ value, time, late }: { value: number; time?: number | null; late?: boolean }) {
  return (
    <span className="kt-bar" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} className={late ? 'late' : ''} />
      {time != null && <b style={{ left: `${Math.max(0, Math.min(100, time * 100))}%` }} />}
    </span>
  );
}
