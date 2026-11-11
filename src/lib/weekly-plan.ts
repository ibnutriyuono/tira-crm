/**
 * Rencana Penjualan mingguan (client-safe).
 *
 * Satu bulan dibagi per tanggal: W1 = tgl 1–7, W2 = 8–14, W3 = 15–21,
 * W4 = 22–28, W5 = 29 s.d. akhir bulan. Rencana mingguan adalah baris
 * SalesPlan (rencana bulanan) yang diberi `minggu`; realisasi PO dihitung
 * dari tanggal PO prospek dan DO terfaktur dari tanggal faktur — semuanya
 * dibandingkan dengan target bulan, tanpa target mingguan.
 */
import { classify, num } from './format';
import type { Prospect, SalesPlan, SalesPlanItem } from './types';

export const BULAN_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export interface PlanWeek {
  n: number;
  start: string;
  end: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Minggu-minggu dalam satu bulan ("YYYY-MM"). */
export function weeksOfMonth(periode: string): PlanWeek[] {
  const [y, m] = periode.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const bl = BULAN_ID[m - 1] || '';
  const out: PlanWeek[] = [];
  for (let n = 1, d = 1; d <= last; n++, d += 7) {
    const e = n === 5 ? last : Math.min(d + 6, last);
    out.push({ n, start: `${periode}-${pad(d)}`, end: `${periode}-${pad(e)}`, label: d === e ? `${d} ${bl}` : `${d}–${e} ${bl}` });
    if (n === 5) break;
  }
  return out;
}

/** Minggu ke- untuk tanggal "YYYY-MM-DD" di bulannya (1–5). */
export function weekOfDate(date: string): number {
  const d = Number(String(date).slice(8, 10));
  return d ? Math.min(5, Math.floor((d - 1) / 7) + 1) : 0;
}

export const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

/** Minggu berjalan untuk bulan ini; 0 bila periode sudah lewat, 6 bila belum mulai. */
export function currentWeek(periode: string, today = todayStr()): number {
  const p = today.slice(0, 7);
  if (periode < p) return 6;
  if (periode > p) return 0;
  return weekOfDate(today);
}

export const itemValue = (it: SalesPlanItem) => num(it.qty) * num(it.harga);

/** Realisasi per minggu dari prospek: PO menurut tanggal PO, DO terfaktur menurut tanggal faktur. */
export function realisasiOf(p: Prospect, periode: string): { po: number; poWeek: number; do: number; doWeek: number } {
  const st = num(p.status);
  const val = num(p.value);
  const tglPo = String(p.tglPO || '').slice(0, 10);
  const tglF = String(p.tglFaktur || '').slice(0, 10);
  const isWon = classify(p) === 'Won';
  const po = isWon && (st === 4 || st === 5) && tglPo.slice(0, 7) === periode ? val : 0;
  const dof = st === 5 && p.terfaktur && tglF.slice(0, 7) === periode ? val : 0;
  return { po, poWeek: po ? weekOfDate(tglPo) : 0, do: dof, doWeek: dof ? weekOfDate(tglF) : 0 };
}

/** Baris rencana aktif milik satu prospek pada periode ini (dari semua rencana SE). */
export function prospectPlanRows(plans: SalesPlan[], prospectId: string, periode: string) {
  const rows: { plan: SalesPlan; item: SalesPlanItem; index: number }[] = [];
  plans
    .filter((pl) => pl.periode === periode)
    .forEach((pl) => (pl.items || []).forEach((item, index) => item.sourceProspectId === prospectId && rows.push({ plan: pl, item, index })));
  return rows;
}

export const periodeOf = (d = todayStr()) => d.slice(0, 7);
export const nextPeriode = (periode: string) => {
  const [y, m] = periode.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
export const labelPeriodeID = (p: string) => `${['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
