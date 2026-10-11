/**
 * Target bulanan default dari target tahunan: dibagi 12, dibulatkan ke rupiah;
 * selisih pembulatan ditaruh di Desember supaya jumlah 12 bulan = tahunan.
 */
export function monthlyFromAnnual(annual: number): number[] {
  const a = Math.max(0, Math.round(annual || 0));
  const base = Math.round(a / 12);
  const out = Array(12).fill(base);
  out[11] = a - base * 11;
  if (out[11] < 0) out[11] = 0;
  return out;
}
