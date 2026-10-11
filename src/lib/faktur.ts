import { canSetFaktur } from './roles';

const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface FakturFields {
  terfaktur: boolean;
  tglFaktur: string | null;
  noFaktur: string | null;
}

/**
 * Status faktur yang disimpan dari form prospek. Hanya Admin Sales / BM /
 * RM / GM / Admin yang boleh mengubahnya; role lain (Sales) tidak bisa
 * mengubah apa pun — nilai lama dipertahankan. Tandai terfaktur tanpa tanggal
 * = hari ini; batal terfaktur mengosongkan tanggal & nomor.
 */
export function resolveFaktur(role: string, body: Record<string, unknown> | null, existing: Partial<FakturFields> | null): FakturFields {
  const keep: FakturFields = { terfaktur: !!existing?.terfaktur, tglFaktur: existing?.tglFaktur ?? null, noFaktur: existing?.noFaktur ?? null };
  if (!canSetFaktur(role) || !body) return keep;
  const terfaktur = 'terfaktur' in body ? !!body.terfaktur : keep.terfaktur;
  if (!terfaktur) return { terfaktur: false, tglFaktur: null, noFaktur: null };
  const tgl = 'tglFaktur' in body ? ymd(body.tglFaktur) : keep.tglFaktur;
  const no = 'noFaktur' in body ? String(body.noFaktur ?? '').trim().slice(0, 60) || null : keep.noFaktur;
  return { terfaktur: true, tglFaktur: tgl || keep.tglFaktur || today(), noFaktur: no };
}

/** Bulan (YYYY-MM) omzet sebuah DO: tanggal faktur, lalu delivery, lalu PO. */
export function omzetPeriode(p: { terfaktur?: boolean; tglFaktur?: string | null; tglDelivery?: string | null; tglPO?: string | null }): string {
  return ((p.terfaktur && p.tglFaktur) || p.tglDelivery || p.tglPO || '').slice(0, 7);
}
