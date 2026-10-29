'use client';

import { api } from '@/lib/api-client';
import { appendSheet, buildBudgetTargetSheet, buildCustomerSheet, buildFupaSheet, buildProspectSheet, buildRfqSheet, buildSalesActivitySheet, buildSalesPlanSheet, STATUS_LEGEND } from '@/lib/exports';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { todayStr } from '@/lib/format';
import type { SalesActivity } from '@/lib/types';
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
export async function exportAllExcel() {
  const s = useDataStore.getState();
  // Aktivitas Harian isn't kept in the store (loaded per month), so it's
  // fetched here -- all months this role can see. A failure skips the sheet.
  let activities: SalesActivity[] = [];
  try {
    activities = (await api.get<{ activities: SalesActivity[] }>('/api/sales-activities?all=1')).activities;
  } catch {
    activities = [];
  }
  const specs = [
    s.prospects.length && buildProspectSheet(s.prospects),
    s.rfqs.length && buildRfqSheet(s.rfqs),
    s.fupas.length && buildFupaSheet(s.fupas),
    s.customers.length && buildCustomerSheet(s.customers),
    s.salesPlans.length && buildSalesPlanSheet(s.salesPlans),
    s.budgetTargets.length && buildBudgetTargetSheet(s.budgetTargets),
    activities.length && buildSalesActivitySheet(activities, s.prospects),
  ].filter(Boolean) as ReturnType<typeof buildProspectSheet>[];
  if (specs.length === 0) return s.toast('Tidak ada data untuk diexport', 'error');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  specs.forEach((spec) => appendSheet(XLSX, wb, spec));
  appendSheet(XLSX, wb, STATUS_LEGEND);
  XLSX.writeFile(wb, `CRM_Export_Semua_${todayStr()}.xlsx`);
  s.toast(`Export semua data berhasil (${specs.length} sheet)`, 'success');
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
