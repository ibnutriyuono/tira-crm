'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { api } from '@/lib/api-client';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { classify, num, todayStr } from '@/lib/format';
import { countNewPurchasingItems } from '@/lib/purchasing-workflow';
import { countUrgentFollowUps } from '@/lib/reports';
import { IconActivity, IconBag, IconBarChart, IconBell, IconCalendar, IconCart, IconChartLine, IconCheckSquare, IconCustomers, IconDatabase, IconExport, IconImport, IconPlus, IconRfq, IconSave, IconSearch, IconTemplate, IconUsers } from './icons';

const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'amber' },
  gm: { label: 'GM', color: 'rust' },
  rm: { label: 'RM', color: 'steel' },
  bm: { label: 'BM', color: 'green' },
  sales: { label: 'Sales', color: 'slate' },
};

export function TopBar() {
  const router = useRouter();
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  // RFQ/FUP A sitting in Purchasing's queue untouched — the same stage-1 count
  // the worklist shows, so the badge and the list can never disagree.
  const newPurchasingCount = countNewPurchasingItems(rfqs, fupas);
  const prospects = useDataStore((s) => s.prospects);
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
    currentUser.role === 'rm' ? ` · Regional ${currentUser.reg ?? '-'}` : currentUser.role === 'bm' ? ` · ${currentUser.cabang || '-'}` : currentUser.role === 'sales' ? ` · ${currentUser.se || '-'}` : '';

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
    const header = ['REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)', 'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'KLASIFIKASI', 'STATUS PENAWARAN'];
    const aoa: unknown[][] = [header];
    list.forEach((r) => {
      aoa.push([r.reg || '', r.cabang || '', r.se || '', r.customer || '', r.phone || '', r.tglPenawaran || '', r.tglPO || '', r.tglDelivery || '', r.line || '', r.uraian || '', num(r.qty), num(r.value), r.kondisiStock || '', r.keterangan || '', num(r.status), classify(r), r.penawaranTerkirim ? 'Terkirim' : 'Pending']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PROSPECT LIST');
    const legend = [['STATUS', 'KETERANGAN'], [0, 'Sales Activity'], [1, 'Permintaan'], [2, 'Penawaran Harga'], [3, 'Negosiasi'], [4, 'PO / Kontrak'], [5, 'DO'], [6, 'Lose Order / Batal']];
    const wsLegend = XLSX.utils.aoa_to_sheet(legend);
    wsLegend['!cols'] = [{ wch: 10 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsLegend, 'Legend Status');
    XLSX.writeFile(wb, `CRM_Prospect_Export_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} data prospek`, 'success');
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
          <img className="logo-img" src="/logo.png" alt="Logo PT Tira Austenite" />
        </span>
        <div>
          <h1>CRM TIRA</h1>
          <span className="sub">Steel Division · PT Tira Austenite</span>
        </div>
      </div>
      <div className="topbar-right">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="user-chip">
            <div>
              <div className="u-name">{currentUser.name}</div>
              <span className={`badge ${rbm.color} u-role`}>
                {rbm.label}
                {roleExtra}
              </span>
            </div>
          </div>
          <button className="btn btn-ghost-dark btn-sm" onClick={logout}>
            Keluar
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
              Kelola Database
            </button>
          )}
          {currentUser.role === 'admin' && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('users')}>
              <IconUsers />
              Kelola User
            </button>
          )}
          <button className="btn btn-ghost-dark" onClick={() => openModal('customers')}>
            <IconCustomers />
            Kelola Customer
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('rfqManage')}>
            <IconRfq />
            Kelola RFQ
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('fupaManage')}>
            <IconCart />
            Kelola FUP A
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('qcdRecap')}>
            <IconCheckSquare />
            Hasil QCD
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('forecast')}>
            <IconChartLine />
            Forecast
          </button>
          <button
            className="btn btn-ghost-dark"
            onClick={() => {
              useUiStore.setState({ salesPlanCtx: null });
              openModal('salesPlan');
            }}
          >
            <IconChartLine />
            Rencana Penjualan
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('marketing')}>
            <IconCustomers />
            Marketing
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('customerIntel')}>
            <IconSearch />
            Customer Intelligence
          </button>
          <button className="btn btn-ghost-dark" onClick={() => openModal('competitorLog')}>
            <IconBarChart />
            Log Kompetitor
          </button>
          <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('followUpBoard')}>
            <IconCalendar />
            Follow-up
            {urgentFollowUpCount > 0 && (
              <span className="topbar-badge" title={`${urgentFollowUpCount} follow-up perlu segera`}>
                {urgentFollowUpCount > 9 ? '9+' : urgentFollowUpCount}
              </span>
            )}
          </button>
          <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('notifications')}>
            <IconBell />
            Notifikasi
            {unreadNotifCount > 0 && (
              <span className="topbar-badge" title={`${unreadNotifCount} notifikasi belum dibaca`}>
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>
          <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('purchasing')}>
            <IconBag />
            Purchasing
            {newPurchasingCount > 0 && (
              <span className="topbar-badge" title={`${newPurchasingCount} RFQ/FUP A baru belum diproses`}>
                {newPurchasingCount > 9 ? '9+' : newPurchasingCount}
              </span>
            )}
          </button>
          <button className="btn btn-ghost-dark" onClick={downloadTemplate}>
            <IconTemplate />
            Template
          </button>
          {currentUser.role === 'admin' && (
            <button
              className="btn btn-ghost-dark"
              onClick={() => {
                useUiStore.setState({ importTarget: 'prospect' });
                openModal('import');
              }}
            >
              <IconImport />
              Import Excel
            </button>
          )}
          <button className="btn btn-ghost-dark" onClick={exportExcel}>
            <IconExport />
            Export Excel
          </button>
          {/* Not in the single-file app's toolbar — this build's own addition,
              kept last so the shared buttons match it 1:1. */}
          <button className="btn btn-ghost-dark" onClick={() => openModal('activity')}>
            <IconActivity />
            Log Aktivitas
          </button>
          <button className="btn btn-outline" onClick={saveAllNow}>
            <IconSave />
            Simpan Perubahan
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              useUiStore.setState({ editProspectId: null });
              openModal('prospectForm');
            }}
          >
            <IconPlus />
            Tambah Prospek
          </button>
        </div>
      </div>
    </div>
  );
}
