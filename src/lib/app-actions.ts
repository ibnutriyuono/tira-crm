'use client';

import { api } from '@/lib/api-client';
import { appendSheet, buildAnnualTargetSheet, buildBudgetTargetSheet, buildCustomerSheet, buildFupaSheet, buildIssueSheet, buildKamSheet, buildProspectSheet, buildRfqSheet, buildSalesActivitySheet, buildSalesPlanSheet, buildSeTargetSheet, buildTripSheet, buildVendorSheet, customerSegmentLookup, STATUS_LEGEND, type SheetSpec } from '@/lib/exports';
import { can } from '@/lib/permissions';
import { canSeeHpp, canSeeVendors } from '@/lib/roles';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { todayStr } from '@/lib/format';
import type { RosterUser, SalesActivity, VisitTrip } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * Aksi umum yang dipakai bar atas lama (TopBar) dan navigasi baru (DeskShell /
 * Ctrl+K) — satu sumber supaya keduanya tidak pernah berbeda perilaku.
 */

export async function logoutNow(router: { replace: (u: string) => void; refresh: () => void }) {
  await api.post('/api/auth/logout');
  useDataStore.getState().reset();
  router.replace('/login');
  router.refresh();
}

export async function saveAllNow(): Promise<string> {
  await Promise.all([useDataStore.getState().refetchProspects(), useDataStore.getState().refetchCustomers()]);
  useDataStore.getState().toast('Semua perubahan tersimpan (realtime ke database)', 'success');
  return 'Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export async function exportProspectsExcel() {
  const toast = useDataStore.getState().toast;
  const ui = useUiStore.getState();
  const list = sortProspects(getFilteredProspects(useDataStore.getState().prospects, ui), ui.sortKey, ui.sortDir);
  if (list.length === 0) return toast('Tidak ada data untuk diexport pada filter saat ini', 'error');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  appendSheet(XLSX, wb, buildProspectSheet(list));
  appendSheet(XLSX, wb, STATUS_LEGEND);
  XLSX.writeFile(wb, `CRM_Prospect_Export_${todayStr()}.xlsx`);
  toast(`Export berhasil: ${list.length} data prospek`, 'success');
}

// One workbook, one sheet per entity — everything the CURRENT user's store
// already holds, which is exactly what they're each individually scoped to see.
// The vendor list is Purchasing data and is never part of this export.
/**
 * Export Semua: satu file, satu sheet per modul — hanya modul yang boleh
 * di-Download role ini (Kelola Role, hak "x"), dan isinya sudah tercakup
 * sesuai role dari server (cabang / regional / Kode SE; HPP, margin & vendor
 * tidak pernah dikirim ke Sales-side). Modul yang tidak dimuat di awal
 * (Aktivitas Harian, Perjalanan Dinas, daftar nama user) diambil di sini;
 * bila gagal, sheet-nya dilewati dan disebut di pesan.
 */
export async function exportAllExcel() {
  const s = useDataStore.getState();
  const role = s.currentUser?.role;
  const x = (mod: string) => can(s.perms, mod, 'x');
  const skipped: string[] = [];
  const fetchOr = async <T,>(url: string, pick: (r: never) => T, label: string, fallback: T): Promise<T> => {
    try {
      return pick((await api.get(url)) as never);
    } catch {
      skipped.push(label);
      return fallback;
    }
  };
  const [activities, trips, roster] = await Promise.all([
    x('aktivitas') ? fetchOr<SalesActivity[]>('/api/sales-activities?all=1', (r: { activities: SalesActivity[] }) => r.activities, 'Aktivitas Harian', []) : Promise.resolve([] as SalesActivity[]),
    x('trip') ? fetchOr<VisitTrip[]>('/api/visit-trips', (r: { trips: VisitTrip[] }) => r.trips, 'Perjalanan Dinas', []) : Promise.resolve([] as VisitTrip[]),
    (x('kam') && s.customerGroups.length) || (x('masalah') && s.issues.length) || x('trip')
      ? fetchOr<RosterUser[]>('/api/users/roster', (r: { roster: RosterUser[] }) => r.roster, 'nama user', [])
      : Promise.resolve([] as RosterUser[]),
  ]);
  const names = new Map(roster.map((u) => [u.id, u.name]));
  const userName = (id: string | null) => (id ? names.get(id) || '' : '');
  const valueById = new Map(s.prospects.map((p) => [p.id, Number(p.value) || 0]));

  const specs = [
    x('prospek') && s.prospects.length && buildProspectSheet(s.prospects, x('customer') ? customerSegmentLookup(s.customers) : undefined),
    x('rfq') && s.rfqs.length && buildRfqSheet(s.rfqs),
    x('rfq') && s.fupas.length && buildFupaSheet(s.fupas),
    x('customer') && s.customers.length && buildCustomerSheet(s.customers),
    x('kam') && s.customerGroups.length && buildKamSheet(s.customerGroups, userName, canSeeHpp(role)),
    x('masalah') && s.issues.length && buildIssueSheet(s.issues, (i) => valueById.get(i.prospectId) || 0, userName, todayStr()),
    x('rencana') && s.salesPlans.length && buildSalesPlanSheet(s.salesPlans),
    x('forecast') && s.budgetTargets.length && buildBudgetTargetSheet(s.budgetTargets),
    x('forecast') && s.annualTargets.length && buildAnnualTargetSheet(s.annualTargets),
    x('forecast') && s.seTargets.length && buildSeTargetSheet(s.seTargets),
    x('aktivitas') && activities.length && buildSalesActivitySheet(activities, s.prospects),
    x('trip') && trips.length && buildTripSheet(trips, userName),
    x('purch') && canSeeVendors(role) && s.vendors.length && buildVendorSheet(s.vendors),
  ].filter(Boolean) as SheetSpec[];
  if (specs.length === 0) return s.toast('Tidak ada data yang boleh diexport untuk role ini', 'error');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  specs.forEach((spec) => appendSheet(XLSX, wb, spec));
  if (specs.some((sp) => sp.sheetName === 'Prospek')) appendSheet(XLSX, wb, STATUS_LEGEND);
  XLSX.writeFile(wb, `CRM_Export_Semua_${todayStr()}.xlsx`);
  s.toast(`Export semua data berhasil (${specs.length} sheet)${skipped.length ? ` · gagal memuat: ${skipped.join(', ')}` : ''}`, skipped.length ? 'info' : 'success');
}

export async function downloadProspectTemplate() {
  const XLSX = await import('xlsx');
  const header = ['REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)', 'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'STATUS PENAWARAN'];
  const example = [1, 'DKI', 'ABC', 'PT. Contoh Customer', '08123456789', '2026-08-01', '', '', '04', 'Contoh uraian produk baja', 10, 50000000, 'Ready Stock', 'Proses penawaran harga', 2, 'Pending'];
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  ws['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'CRM_Prospect_Template.xlsx');
  useDataStore.getState().toast('Template Excel berhasil diunduh', 'success');
}
