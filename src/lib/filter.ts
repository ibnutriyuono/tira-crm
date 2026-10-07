import { classify, num } from './format';
import { createdInRange, localDateOf, type CreatedRange } from './new-records';
import type { Prospect } from './types';

interface FilterState {
  search: string;
  fReg: string;
  fCabang: string;
  fSe: string;
  fKlas: string;
  fStatus: string;
  fPenawaran: string;
  fBulan: string;
  fTahun: string;
  /** Dibuat hari ini / minggu ini (by createdAt). */
  fDibuat?: string;
}

/** Local YYYY-MM-DD of the last status change; offer date for old rows without one. */
export function changeDate(r: Pick<Prospect, 'statusChangedAt' | 'tglPenawaran'>): string {
  return localDateOf(r.statusChangedAt as string | null | undefined) || r.tglPenawaran || '';
}

// Role-based scoping already happened server-side (prospectScopeWhere) —
// this only re-implements the original's client-side filter/search/sort.
export function getFilteredProspects(records: Prospect[], f: FilterState): Prospect[] {
  let list = records;
  if (f.fReg) list = list.filter((r) => String(r.reg) === String(f.fReg));
  if (f.fCabang) list = list.filter((r) => (r.cabang || '') === f.fCabang);
  if (f.fSe) list = list.filter((r) => (r.se || '') === f.fSe);
  if (f.fStatus !== '') list = list.filter((r) => num(r.status) === Number(f.fStatus));
  if (f.fKlas) list = list.filter((r) => classify(r) === f.fKlas);
  if (f.fPenawaran === 'sent') list = list.filter((r) => !!r.penawaranTerkirim);
  else if (f.fPenawaran === 'pending') list = list.filter((r) => !r.penawaranTerkirim);
  // Bulan/Tahun = when the prospect last changed status (local date), the
  // same date the Kanban column filters and Aging use -- not the offer date.
  if (f.fBulan) list = list.filter((r) => changeDate(r).slice(5, 7) === f.fBulan);
  if (f.fTahun) list = list.filter((r) => changeDate(r).slice(0, 4) === f.fTahun);
  if (f.fDibuat) {
    const now = new Date();
    list = list.filter((r) => createdInRange(r, f.fDibuat as CreatedRange, now));
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(
      (r) =>
        (r.customer || '').toLowerCase().includes(q) ||
        (r.uraian || '').toLowerCase().includes(q) ||
        (r.se || '').toLowerCase().includes(q) ||
        (r.keterangan || '').toLowerCase().includes(q),
    );
  }
  return list;
}

export function sortProspects(list: Prospect[], sortKey: string, sortDir: 'asc' | 'desc'): Prospect[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let va: unknown = (a as unknown as Record<string, unknown>)[sortKey];
    let vb: unknown = (b as unknown as Record<string, unknown>)[sortKey];
    if (['value', 'qty', 'status', 'reg'].includes(sortKey)) {
      return (num(va) - num(vb)) * dir;
    }
    if (sortKey === 'penawaranTerkirim') {
      return ((va ? 1 : 0) - (vb ? 1 : 0)) * dir;
    }
    if (['tglPenawaran', 'tglPO', 'tglDelivery'].includes(sortKey)) {
      va = va || '';
      vb = vb || '';
      return String(va).localeCompare(String(vb)) * dir;
    }
    va = (va || '').toString().toLowerCase();
    vb = (vb || '').toString().toLowerCase();
    return String(va).localeCompare(String(vb)) * dir;
  });
}
