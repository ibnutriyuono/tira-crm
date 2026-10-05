/**
 * Structured QCD (Quality · Cost · Delivery) captured when a deal closes --
 * entering Won (PO/Kontrak or DO from an open stage) or Lost (Lose Order).
 * Dropdown values are what the dashboard counts; the old free-text fields
 * (qcdQuality/qcdCost/qcdDelivery) stay as optional "keterangan".
 * Pure: shared by the forms, the API gate and the KPI dashboard.
 */

export type QcdLevel = 'unggul' | 'setara' | 'kalah';
export type QcdDim = 'quality' | 'cost' | 'delivery';

export const QCD_DIMS: { key: QcdDim; label: string; field: 'qcdQualityLevel' | 'qcdCostLevel' | 'qcdDeliveryLevel'; options: Record<QcdLevel, string> }[] = [
  { key: 'quality', label: 'Quality', field: 'qcdQualityLevel', options: { unggul: 'Lebih baik', setara: 'Setara', kalah: 'Lebih buruk' } },
  { key: 'cost', label: 'Cost (Harga)', field: 'qcdCostLevel', options: { unggul: 'Lebih murah', setara: 'Setara', kalah: 'Lebih mahal' } },
  { key: 'delivery', label: 'Delivery', field: 'qcdDeliveryLevel', options: { unggul: 'Lebih cepat', setara: 'Setara', kalah: 'Lebih lambat' } },
];
export const QCD_LEVELS: QcdLevel[] = ['unggul', 'setara', 'kalah'];

export const QCD_FAKTOR: { key: string; label: string }[] = [
  { key: 'harga', label: 'Harga' },
  { key: 'kualitas', label: 'Kualitas / spesifikasi' },
  { key: 'delivery', label: 'Waktu kirim' },
  { key: 'stok', label: 'Ketersediaan stok' },
  { key: 'relasi', label: 'Relasi / layanan' },
  { key: 'pembayaran', label: 'Syarat pembayaran' },
  { key: 'batal', label: 'Proyek batal / ditunda' },
  { key: 'lainnya', label: 'Lainnya' },
];
export const QCD_FAKTOR_LABEL: Record<string, string> = Object.fromEntries(QCD_FAKTOR.map((f) => [f.key, f.label]));

export interface QcdInput {
  qcdQualityLevel?: unknown;
  qcdCostLevel?: unknown;
  qcdDeliveryLevel?: unknown;
  qcdFaktor?: unknown;
  qcdKompetitor?: unknown;
}

const s = (v: unknown) => String(v ?? '').trim();

/** Won = PO/Kontrak (4) or DO (5); Lost = 6. */
export const isWonStatus = (st: number) => st === 4 || st === 5;

/** QCD is due when a deal moves INTO Won from a non-won stage, or INTO Lost. Moving PO -> DO is not a new close. */
export function qcdRequiredOnMove(prevStatus: number | null, nextStatus: number): boolean {
  if (prevStatus === nextStatus) return false;
  if (nextStatus === 6) return true;
  if (isWonStatus(nextStatus)) return prevStatus == null || !isWonStatus(prevStatus);
  return false;
}

/**
 * What is missing for a closing move: the three Q/C/D levels and the deciding
 * factor always; the competitor too when the deal is lost (who won it).
 * Returns null when complete.
 */
export function qcdMissing(nextStatus: number, q: QcdInput): string | null {
  const miss: string[] = [];
  const valid = (v: unknown) => (QCD_LEVELS as string[]).includes(s(v));
  if (!valid(q.qcdQualityLevel)) miss.push('Quality');
  if (!valid(q.qcdCostLevel)) miss.push('Cost');
  if (!valid(q.qcdDeliveryLevel)) miss.push('Delivery');
  if (!QCD_FAKTOR_LABEL[s(q.qcdFaktor)]) miss.push('Faktor penentu');
  if (nextStatus === 6 && !s(q.qcdKompetitor)) miss.push('Kompetitor');
  return miss.length ? `QCD wajib diisi: ${miss.join(', ')}.` : null;
}

/** Normalizes a dropdown value for storage (unknown -> null). */
export function cleanLevel(v: unknown): QcdLevel | null {
  const x = s(v);
  return (QCD_LEVELS as string[]).includes(x) ? (x as QcdLevel) : null;
}
export function cleanFaktor(v: unknown): string | null {
  const x = s(v);
  return QCD_FAKTOR_LABEL[x] ? x : null;
}
