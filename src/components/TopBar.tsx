'use client';

import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { isOpenIssue } from '@/lib/issues';
import { can, type PermAct } from '@/lib/permissions';
import { adminTaskCount } from './modals/AdminQueueModal';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { api } from '@/lib/api-client';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { todayStr } from '@/lib/format';
import { countNewPurchasingItems } from '@/lib/purchasing-workflow';
import { countUrgentFollowUps } from '@/lib/reports';
import { appendSheet, buildBudgetTargetSheet, buildCustomerSheet, buildFupaSheet, buildProspectSheet, buildRfqSheet, buildSalesActivitySheet, buildSalesPlanSheet, buildVendorSheet, STATUS_LEGEND } from '@/lib/exports';
import { IconActivity, IconBag, IconBarChart, IconBell, IconCalendar, IconCart, IconChartLine, IconCheckSquare, IconCustomers, IconDatabase, IconDownload, IconExport, IconImport, IconPlus, IconPresentation, IconRfq, IconSave, IconSearch, IconTarget, IconTemplate, IconUsers } from './icons';
import type { SalesActivity } from '@/lib/types';

import { useT } from '@/store/useLangStore';
import { LangSwitch } from './LangSwitch';
const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'amber' },
  gm: { label: 'GM', color: 'rust' },
  rm: { label: 'RM', color: 'steel' },
  bm: { label: 'BM', color: 'green' },
  sales: { label: 'Sales', color: 'slate' },
};

export function TopBar() {
  const tr = useT();
  const router = useRouter();
  const currentUser = useDataStore((s) => s.currentUser);
  const issues = useDataStore((s) => s.issues);
  const toast = useDataStore((s) => s.toast);
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  // RFQ/FUP A sitting in Purchasing's queue untouched — the same stage-1 count
  // the worklist shows, so the badge and the list can never disagree.
  const newPurchasingCount = countNewPurchasingItems(rfqs, fupas);
  const prospects = useDataStore((s) => s.prospects);
  const adminTasks = useMemo(() => adminTaskCount(prospects), [prospects]);
  // Kelola Role: menu yang tidak berhak dilihat disembunyikan.
  const perms = useDataStore((s) => s.perms);
  const c = (mod: string, act: PermAct = 'v') => can(perms, mod, act);
  // Badge Masalah: yang menunggu tindakan user ini — PJ dari masalah terbuka,
  // atau (BM) usulan Sales di cabangnya yang belum diproses.
  const issueCount = issues.filter(
    (i) =>
      (isOpenIssue(i) && i.pjIds.includes(currentUser?.id || '')) ||
      (i.status === 'usulan' && (currentUser?.role === 'admin' || (currentUser?.role === 'bm' && (i.cabang || '').toUpperCase() === (currentUser?.cabang || '').toUpperCase()))),
  ).length;
  // Same builder the Follow-up panel itself renders from (buildFollowUpRows),
  // so this count and what's actually listed inside can never disagree.
  const urgentFollowUpCount = countUrgentFollowUps(prospects);
  const notifications = useDataStore((s) => s.notifications);
  const unreadNotifCount = notifications.filter((n) => !n.readAt).length;
  const openModal = useUiStore((s) => s.openModal);
  const [savedLabel, setSavedLabel] = useState('');

  if (!currentUser) return null;
  const rbm = ROLE_LABEL[currentUser.role] || { label: currentUser.role, color: 'slate' };
  const roleExtra =
    currentUser.role === 'rm' ? ` · Regional ${currentUser.reg ?? '-'}` : currentUser.role === 'bm' || currentUser.role === 'salesadmin' ? ` · ${currentUser.cabang || '-'}` : currentUser.role === 'sales' ? ` · ${currentUser.se || '-'}` : '';

  async function logout() {
    await api.post('/api/auth/logout');
    useDataStore.getState().reset();
    router.replace('/login');
    router.refresh();
  }

  async function saveAllNow() {
    await Promise.all([useDataStore.getState().refetchProspects(), useDataStore.getState().refetchCustomers()]);
    setSavedLabel('Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    toast('Semua perubahan tersimpan (realtime ke database)', 'success');
  }

  async function exportExcel() {
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

  // One workbook, one sheet per entity — everything the CURRENT user's
  // store already holds, which is exactly what they're each individually
  // scoped to see (prospects/rfqs/fupas/salesPlans server-scoped by role;
  // customers/vendors/budgetTargets are company-wide for everyone already).
  // Reuses the exact same builders as every per-module export button above,
  // so a sheet in here never drifts from what "Export Excel" on that
  // module's own screen produces.
  async function exportAllExcel() {
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
      s.vendors.length && buildVendorSheet(s.vendors),
      s.salesPlans.length && buildSalesPlanSheet(s.salesPlans),
      s.budgetTargets.length && buildBudgetTargetSheet(s.budgetTargets),
      activities.length && buildSalesActivitySheet(activities, s.prospects),
    ].filter(Boolean) as ReturnType<typeof buildProspectSheet>[];
    if (specs.length === 0) return toast('Tidak ada data untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    specs.forEach((spec) => appendSheet(XLSX, wb, spec));
    appendSheet(XLSX, wb, STATUS_LEGEND);
    XLSX.writeFile(wb, `CRM_Export_Semua_${todayStr()}.xlsx`);
    toast(`Export semua data berhasil (${specs.length} sheet)`, 'success');
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const header = ['REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)', 'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'STATUS PENAWARAN'];
    const example = [1, 'DKI', 'ABC', 'PT. Contoh Customer', '08123456789', '2026-08-01', '', '', '04', 'Contoh uraian produk baja', 10, 50000000, 'Ready Stock', 'Proses penawaran harga', 2, 'Pending'];
    const ws = XLSX.utils.aoa_to_sheet([header, example]);
    ws['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'CRM_Prospect_Template.xlsx');
    toast('Template Excel berhasil diunduh', 'success');
  }

  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo-chip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/logo.png" alt={tr("Logo PT. TIRA AUSTENITE, Tbk")} />
        </span>
        <div>
          <h1>{tr("CRM TIRA")}</h1>
          <span className="sub">{tr("Steel Division · PT. TIRA AUSTENITE,")} <span style={{ textTransform: 'none' }}>{tr("Tbk")}</span></span>
        </div>
      </div>
      <div className="topbar-right">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="user-chip">
            <div>
              <div className="u-name">{currentUser.name}</div>
              <span className={`badge ${rbm.color} u-role`} title={currentUser.customRoleLabel ? `Role: ${currentUser.customRoleLabel} (tipe dasar ${rbm.label})` : undefined}>
                {currentUser.customRoleLabel ? `${currentUser.customRoleLabel} · ${rbm.label}${roleExtra.replace(/^ · /, ' ')}` : `${rbm.label}${roleExtra}`}
              </span>
            </div>
          </div>
          <LangSwitch dark />
          <button className="btn btn-ghost-dark btn-sm" onClick={() => openModal('account')} title={tr("Ubah username, password & email")}>
            {tr("Akun Saya")}
          </button>
          <button className="btn btn-ghost-dark btn-sm" onClick={logout}>
            {tr("Keluar")}
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--slate-300)', fontFamily: "var(--font-ibm-plex-mono), monospace" }}>{savedLabel}</span>
        <div className="topbar-actions">
          {/* Deliberate divergence from the single-file app, which shows these to
              every role: Kelola Database, Kelola User and Import Excel are
              admin-only here. Their APIs already enforce requireAdmin, so
              showing them to Sales would just open modals that 403. Decided
              2026-08-23 — do not "fix" this to match the mockup. */}
          {currentUser.role === 'admin' && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('database')}>
              <IconDatabase />
              {tr("Kelola Database")}
            </button>
          )}
          {currentUser.role === 'admin' && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('users')}>
              <IconUsers />
              {tr("Kelola User")}
            </button>
          )}
          {currentUser.role === 'admin' && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('roles')}>
              <IconUsers />
              {tr("Kelola Role")}
            </button>
          )}
          {c('faktur') && (
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('adminQueue')}>
              <IconCheckSquare />
              {tr("Antrian Admin")}
              {currentUser.role === 'salesadmin' && adminTasks > 0 && (
                <span className="topbar-badge" title={`${adminTasks} tugas admin terbuka`}>
                  {adminTasks > 9 ? '9+' : adminTasks}
                </span>
              )}
            </button>
          )}
          {!isPurchasingRoleClient(currentUser.role) && c('analisa') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('gmAnalysis')}>
              <IconPresentation />
              {tr("Analisa Eksekutif")}
            </button>
          )}
          {c('customer') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('customers')}>
              <IconCustomers />
              {tr("Kelola Customer")}
            </button>
          )}
          {c('rfq') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('rfqManage')}>
              <IconRfq />
              {tr("Kelola RFQ")}
            </button>
          )}
          {c('rfq') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('fupaManage')}>
              <IconCart />
              {tr("Kelola FUP A")}
            </button>
          )}
          {c('marketing') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('qcdRecap')}>
              <IconCheckSquare />
              {tr("Hasil QCD")}
            </button>
          )}
          {c('forecast') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('forecast')}>
              <IconChartLine />
              {tr("Forecast")}
            </button>
          )}
          {c('kpi') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('kpi')}>
              <IconTarget />
              KPI
            </button>
          )}
          {c('kpi') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('activityKpi')}>
              <IconTarget />
              {tr("KPI Aktivitas")}
            </button>
          )}
          {/* Kelola Role menentukan: hak yang dicentang = tombol tampil. Batas
              tipe dasar (mis. Antrian Admin tidak untuk Sales) sudah dipotong
              di hak efektif (ROLE_LIMITS), jadi tidak perlu cek role di sini. */}
          {c('trip') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('visitTrip')}>
              <IconCalendar />
              {tr("Perjalanan Dinas")}
            </button>
          )}
          {c('rencana') && (
            <button
              className="btn btn-ghost-dark"
              onClick={() => {
                useUiStore.setState({ salesPlanCtx: null });
                openModal('salesPlan');
              }}
            >
              <IconChartLine />
              {tr("Rencana Penjualan")}
            </button>
          )}
          {c('marketing') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('marketing')}>
              <IconCustomers />
              {tr("Marketing")}
            </button>
          )}
          {c('marketing') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('customerIntel')}>
              <IconSearch />
              {tr("Customer Intelligence")}
            </button>
          )}
          {!isPurchasingRoleClient(currentUser.role) && c('kam') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('keyAccount')}>
              <IconTarget />
              {tr("Key Account")}
            </button>
          )}
          {!isPurchasingRoleClient(currentUser.role) && c('masalah') && (
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('pipelineIssues')}>
              <span aria-hidden="true">⚑</span>
              {tr("Masalah")}
              {issueCount > 0 && (
                <span className="topbar-badge" title={`${issueCount} masalah perlu tindakan Anda`}>
                  {issueCount > 9 ? '9+' : issueCount}
                </span>
              )}
            </button>
          )}
          {c('marketing') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('competitorLog')}>
              <IconBarChart />
              {tr("Log Kompetitor")}
            </button>
          )}
          {c('prospek') && (
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('followUpBoard')}>
              <IconCalendar />
              {tr("Follow-up")}
              {urgentFollowUpCount > 0 && (
                <span className="topbar-badge" title={`${urgentFollowUpCount} follow-up perlu segera`}>
                  {urgentFollowUpCount > 9 ? '9+' : urgentFollowUpCount}
                </span>
              )}
            </button>
          )}
          <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('notifications')}>
            <IconBell />
            {tr("Notifikasi")}
            {unreadNotifCount > 0 && (
              <span className="topbar-badge" title={`${unreadNotifCount} notifikasi belum dibaca`}>
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>
          {c(isPurchasingRoleClient(currentUser.role) ? 'purch' : 'rfq') && (
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('purchasing')}>
              <IconBag />
              {tr("Purchasing")}
              {newPurchasingCount > 0 && (
                <span className="topbar-badge" title={`${newPurchasingCount} RFQ/FUP A baru belum diproses`}>
                  {newPurchasingCount > 9 ? '9+' : newPurchasingCount}
                </span>
              )}
            </button>
          )}
          {c('prospek', 'x') && (
            <button className="btn btn-ghost-dark" onClick={downloadTemplate}>
              <IconTemplate />
              {tr("Template")}
            </button>
          )}
          {currentUser.role === 'admin' && (
            <button
              className="btn btn-ghost-dark"
              onClick={() => {
                useUiStore.setState({ importTarget: 'prospect' });
                openModal('import');
              }}
            >
              <IconImport />
              {tr("Import Excel")}
            </button>
          )}
          {c('prospek', 'x') && (
            <button className="btn btn-ghost-dark" onClick={exportExcel}>
              <IconExport />
              {tr("Export Excel")}
            </button>
          )}
          {c('prospek', 'x') && (
            <button className="btn btn-ghost-dark" onClick={exportAllExcel} title={tr("Satu file Excel berisi semua data (Prospek, RFQ, FUP A, Customer, Vendor, Rencana Penjualan, Target), tiap jenis di sheet terpisah")}>
              <IconDownload />
              {tr("Export Semua")}
            </button>
          )}
          {/* Not in the single-file app's toolbar — this build's own addition,
              kept last so the shared buttons match it 1:1. */}
          {c('log') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('activity')}>
              <IconActivity />
              {tr("Log Aktivitas")}
            </button>
          )}
          <button className="btn btn-outline" onClick={saveAllNow}>
            <IconSave />
            {tr("Simpan Perubahan")}
          </button>
          {c('aktivitas') && (
            <button className="btn btn-activity" onClick={() => openModal('salesActivity')}>
              <IconCalendar />
              {tr("Aktivitas Harian")}
            </button>
          )}
          {c('prospek', 'e') && (
            <button
              className="btn btn-primary"
              onClick={() => {
                useUiStore.setState({ editProspectId: null });
                openModal('prospectForm');
              }}
            >
              <IconPlus />
              {tr("Tambah Prospek")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
