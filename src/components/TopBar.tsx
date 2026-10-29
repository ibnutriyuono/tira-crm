'use client';

import { canComposeMail } from '@/lib/compose-email';
import { quotePermAct } from '@/lib/roles';
import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { isOpenIssue } from '@/lib/issues';
import { can, type PermAct } from '@/lib/permissions';
import { adminTaskCount } from './modals/AdminQueueModal';
import { useRouter } from 'next/navigation';
import { isOpsLead } from '@/lib/roles';
import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { api } from '@/lib/api-client';
import { countNewPurchasingItems } from '@/lib/purchasing-workflow';
import { countUrgentFollowUps } from '@/lib/reports';
import { downloadProspectTemplate, exportAllExcel, exportProspectsExcel, logoutNow, saveAllNow } from '@/lib/app-actions';
import { setDeskPref } from '@/hooks/useDeskMode';
import { IconActivity, IconBag, IconBarChart, IconBell, IconCalendar, IconCart, IconChartLine, IconCheckSquare, IconCustomers, IconDatabase, IconDoc, IconMail, IconDownload, IconExport, IconFlag, IconImport, IconPlus, IconPresentation, IconRfq, IconSave, IconSearch, IconTarget, IconTemplate, IconUsers } from './icons';

import { useT } from '@/store/useLangStore';
import { LangSwitch } from './LangSwitch';
const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'amber' },
  vp: { label: 'VP', color: 'rust' },
  gm: { label: 'GM', color: 'rust' },
  gmops: { label: 'GM Operation', color: 'rust' },
  rm: { label: 'RM', color: 'steel' },
  bm: { label: 'BM', color: 'green' },
  sales: { label: 'Sales', color: 'slate' },
};

export function TopBar() {
  const tr = useT();
  const router = useRouter();
  const currentUser = useDataStore((s) => s.currentUser);
  const issues = useDataStore((s) => s.issues);
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
  // Badge Tugas Kunjungan (dihitung server; diperbarui saat ada perubahan tugas / rencana).
  const [visitBadge, setVisitBadge] = useState(0);
  const myRole = currentUser?.role;
  useEffect(() => {
    if (!myRole || !['sales', 'bm', 'rm', 'gm', 'vp', 'admin', 'salesadmin'].includes(myRole)) return;
    let alive = true;
    const load = () =>
      api
        .get<{ open: number; late: number; plans: number }>('/api/visit-tasks?count=1')
        .then((r) => alive && setVisitBadge(myRole === 'sales' ? r.open : r.late + r.plans))
        .catch(() => {});
    load();
    const s = getSocket();
    s.on('visitTask:updated', load);
    s.on('visitPlan:updated', load);
    return () => {
      alive = false;
      s.off('visitTask:updated', load);
      s.off('visitPlan:updated', load);
    };
  }, [myRole]);
  const openModal = useUiStore((s) => s.openModal);
  const [savedLabel, setSavedLabel] = useState('');

  if (!currentUser) return null;
  const rbm = ROLE_LABEL[currentUser.role] || { label: currentUser.role, color: 'slate' };
  const roleExtra =
    currentUser.role === 'rm' ? ` · Regional ${currentUser.reg ?? '-'}` : currentUser.role === 'bm' || currentUser.role === 'salesadmin' ? ` · ${currentUser.cabang || '-'}` : currentUser.role === 'sales' ? ` · ${currentUser.se || '-'}` : '';

  const logout = () => logoutNow(router);
  const saveAll = async () => setSavedLabel(await saveAllNow());

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
          <button className="btn btn-ghost-dark btn-sm" onClick={() => setDeskPref('baru')} title={tr("Navigasi kiri, Beranda & panel prospek")}>
            {tr("Tampilan baru")}
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
          {currentUser.role === 'admin' && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('opsRules')} title={tr("Pengingat & eskalasi Operation, margin minimum Surat Penawaran")}>
              <IconCheckSquare />
              {tr("Batas Waktu & Margin")}
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
          {['sales', 'bm', 'rm', 'gm', 'vp', 'admin', 'salesadmin'].includes(currentUser.role) && (
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => openModal('visitTasks')} title={tr("Tugas kunjungan dari BM / GM dan rencana kunjungan mingguan")}>
              <IconFlag />
              {tr("Tugas Kunjungan")}
              {visitBadge > 0 && (
                <span className="topbar-badge" title={currentUser.role === 'sales' ? `${visitBadge} tugas kunjungan terbuka` : `${visitBadge} terlambat / rencana menunggu persetujuan`}>
                  {visitBadge > 9 ? '9+' : visitBadge}
                </span>
              )}
            </button>
          )}
          {(isOpsLead(currentUser.role) || currentUser.role === 'admin') && (
            <button className="btn btn-ghost-dark" onClick={() => openModal('leadDesk')} title={tr("Beranda VP / GM Operation: keputusan yang menunggu, kinerja divisi")}>
              <IconPresentation />
              {tr("Beranda Pimpinan")}
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
            <button className="btn btn-ghost-dark" style={{ position: 'relative' }} onClick={() => (isOpsLead(currentUser.role) ? router.push('/purchasing') : openModal('purchasing'))} title={isOpsLead(currentUser.role) ? tr('Buka ruang kerja Purchasing') : undefined}>
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
            <button className="btn btn-ghost-dark" onClick={downloadProspectTemplate}>
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
            <button className="btn btn-ghost-dark" onClick={exportProspectsExcel}>
              <IconExport />
              {tr("Export Excel")}
            </button>
          )}
          {c('prospek', 'x') && (
            <button className="btn btn-ghost-dark" onClick={exportAllExcel} title={tr("Satu file Excel berisi semua data (Prospek, RFQ, FUP A, Customer, Rencana Penjualan, Target, Aktivitas Harian), tiap jenis di sheet terpisah")}>
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
          <button className="btn btn-outline" onClick={saveAll}>
            <IconSave />
            {tr("Simpan Perubahan")}
          </button>
          {canComposeMail(currentUser?.role) && (
            <button className="btn btn-outline" onClick={() => openModal('mailCompose')} title={tr("Kirim pengumuman ke user CRM atau email ke customer")}>
              <IconMail />
              {tr("Kirim Email")}
            </button>
          )}
          {c('aktivitas') && (
            <button className="btn btn-activity" onClick={() => openModal('salesActivity')}>
              <IconCalendar />
              {tr("Aktivitas Harian")}
            </button>
          )}
          {c('prospek', 'e') && c('prospek', quotePermAct(currentUser?.role)) && (
            <button
              className="btn btn-quote"
              title={tr("Prospek baru di tahap Penawaran Harga, lalu langsung buat surat penawarannya")}
              onClick={() => {
                useUiStore.setState({ editProspectId: null, prospectFormQuote: true });
                openModal('prospectForm');
              }}
            >
              <IconDoc />
              {tr("Buat Penawaran")}
            </button>
          )}
          {c('prospek', 'e') && (
            <button
              className="btn btn-primary"
              onClick={() => {
                useUiStore.setState({ editProspectId: null, prospectFormQuote: false });
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
