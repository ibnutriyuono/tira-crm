'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { downloadProspectTemplate, exportAllExcel, exportProspectsExcel, logoutNow, saveAllNow } from '@/lib/app-actions';
import { canComposeMail } from '@/lib/compose-email';
import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { isOpenIssue } from '@/lib/issues';
import { can, type PermAct } from '@/lib/permissions';
import { countNewPurchasingItems } from '@/lib/purchasing-workflow';
import { countUrgentFollowUps } from '@/lib/reports';
import { isOpsLead, quotePermAct } from '@/lib/roles';
import { getSocket } from '@/lib/socket-client';
import { setDeskPref } from '@/hooks/useDeskMode';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore, type ModalKey } from '@/store/useUiStore';
import { adminTaskCount } from '../modals/AdminQueueModal';
import { IconActivity, IconBag, IconBarChart, IconBell, IconCalendar, IconCart, IconChartLine, IconCheckSquare, IconCustomers, IconDatabase, IconDoc, IconDownload, IconExport, IconFlag, IconImport, IconMail, IconPlus, IconPresentation, IconRfq, IconSave, IconSearch, IconTarget, IconTemplate, IconUsers } from '../icons';

export type NavGroup = 'Kerja' | 'Penjualan' | 'Customer' | 'Purchasing' | 'Analisa' | 'Admin' | 'Data';

export interface NavItem {
  id: string;
  label: string;
  group: NavGroup;
  icon: ReactNode;
  run: () => void;
  badge?: number;
  hint?: string;
  /** Kata kunci tambahan untuk pencarian Ctrl+K. */
  keys?: string;
}

/** Badge Tugas Kunjungan (hitungan server, diperbarui lewat socket). */
function useVisitBadge(role: string | undefined) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!role || !['sales', 'bm', 'rm', 'gm', 'vp', 'admin', 'salesadmin'].includes(role)) return;
    let alive = true;
    const load = () =>
      api
        .get<{ open: number; late: number; plans: number }>('/api/visit-tasks?count=1')
        .then((r) => alive && setN(role === 'sales' ? r.open : r.late + r.plans))
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
  }, [role]);
  return n;
}

/**
 * Semua menu CRM untuk navigasi kiri & Ctrl+K — hak akses dan badge sama
 * persis dengan bar atas lama (TopBar).
 */
export function useNavItems(tr: (s: string) => string): { items: NavItem[]; unread: number } {
  const router = useRouter();
  const me = useDataStore((s) => s.currentUser);
  const perms = useDataStore((s) => s.perms);
  const issues = useDataStore((s) => s.issues);
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const prospects = useDataStore((s) => s.prospects);
  const notifications = useDataStore((s) => s.notifications);
  const visitBadge = useVisitBadge(me?.role);

  const items = useMemo(() => {
    if (!me) return [];
    const role = me.role;
    const c = (mod: string, act: PermAct = 'v') => can(perms, mod, act);
    const open = (m: ModalKey) => () => useUiStore.getState().openModal(m);
    const purch = isPurchasingRoleClient(role);
    const issueCount = issues.filter(
      (i) =>
        (isOpenIssue(i) && i.pjIds.includes(me.id)) ||
        (i.status === 'usulan' && (role === 'admin' || (role === 'bm' && (i.cabang || '').toUpperCase() === (me.cabang || '').toUpperCase()))),
    ).length;
    const out: (NavItem | false)[] = [
      // Kerja harian
      c('aktivitas') && { id: 'aktivitas', label: tr('Aktivitas Harian'), group: 'Kerja', icon: <IconCalendar />, run: open('salesActivity'), keys: 'kunjungan telepon meeting catat' },
      c('prospek') && { id: 'followup', label: tr('Follow-up'), group: 'Kerja', icon: <IconCalendar />, run: open('followUpBoard'), badge: countUrgentFollowUps(prospects), keys: 'papan jatuh tempo terlambat' },
      ['sales', 'bm', 'rm', 'gm', 'vp', 'admin', 'salesadmin'].includes(role) && { id: 'tugas', label: tr('Tugas Kunjungan'), group: 'Kerja', icon: <IconFlag />, run: open('visitTasks'), badge: visitBadge, keys: 'rencana mingguan' },
      !purch && c('masalah') && { id: 'masalah', label: tr('Masalah'), group: 'Kerja', icon: <span aria-hidden="true">⚑</span>, run: open('pipelineIssues'), badge: issueCount, keys: 'issue kendala pipeline' },
      c('faktur') && { id: 'antrian', label: tr('Antrian Admin'), group: 'Kerja', icon: <IconCheckSquare />, run: open('adminQueue'), badge: role === 'salesadmin' ? adminTaskCount(prospects) : 0, keys: 'faktur do pengiriman' },
      // Penjualan
      c('prospek', 'e') && { id: 'tambah', label: tr('Tambah Prospek'), group: 'Penjualan', icon: <IconPlus />, run: () => { useUiStore.setState({ editProspectId: null, prospectFormQuote: false }); useUiStore.getState().openModal('prospectForm'); }, keys: 'baru prospek' },
      c('prospek', 'e') && c('prospek', quotePermAct(role)) && { id: 'penawaran', label: tr('Buat Penawaran'), group: 'Penjualan', icon: <IconDoc />, run: () => { useUiStore.setState({ editProspectId: null, prospectFormQuote: true }); useUiStore.getState().openModal('prospectForm'); }, keys: 'surat penawaran quotation' },
      c('rencana') && { id: 'rencana', label: tr('Rencana Penjualan'), group: 'Penjualan', icon: <IconChartLine />, run: () => { useUiStore.setState({ salesPlanCtx: null }); useUiStore.getState().openModal('salesPlan'); } },
      c('trip') && { id: 'trip', label: tr('Perjalanan Dinas'), group: 'Penjualan', icon: <IconCalendar />, run: open('visitTrip') },
      canComposeMail(role) && { id: 'mail', label: tr('Kirim Email'), group: 'Penjualan', icon: <IconMail />, run: open('mailCompose'), keys: 'pengumuman email' },
      // Customer
      c('customer') && { id: 'customer', label: tr('Kelola Customer'), group: 'Customer', icon: <IconCustomers />, run: open('customers') },
      !purch && c('kam') && { id: 'kam', label: tr('Key Account'), group: 'Customer', icon: <IconTarget />, run: open('keyAccount'), keys: 'kam strategic' },
      c('marketing') && { id: 'intel', label: tr('Customer Intelligence'), group: 'Customer', icon: <IconSearch />, run: open('customerIntel') },
      c('marketing') && { id: 'marketing', label: tr('Marketing'), group: 'Customer', icon: <IconCustomers />, run: open('marketing') },
      c('marketing') && { id: 'kompetitor', label: tr('Log Kompetitor'), group: 'Customer', icon: <IconBarChart />, run: open('competitorLog') },
      // Purchasing
      c(purch ? 'purch' : 'rfq') && { id: 'purchasing', label: tr('Purchasing'), group: 'Purchasing', icon: <IconBag />, run: isOpsLead(role) ? () => router.push('/purchasing') : open('purchasing'), badge: countNewPurchasingItems(rfqs, fupas) },
      c('rfq') && { id: 'rfq', label: tr('Kelola RFQ'), group: 'Purchasing', icon: <IconRfq />, run: open('rfqManage') },
      c('rfq') && { id: 'fupa', label: tr('Kelola FUP A'), group: 'Purchasing', icon: <IconCart />, run: open('fupaManage') },
      c('marketing') && { id: 'qcd', label: tr('Hasil QCD'), group: 'Purchasing', icon: <IconCheckSquare />, run: open('qcdRecap'), keys: 'quality cost delivery kalah' },
      // Analisa
      !purch && c('analisa') && { id: 'analisa', label: tr('Analisa Eksekutif'), group: 'Analisa', icon: <IconPresentation />, run: open('gmAnalysis'), keys: 'ppt laporan cabang' },
      (isOpsLead(role) || role === 'admin') && { id: 'pimpinan', label: tr('Beranda Pimpinan'), group: 'Analisa', icon: <IconPresentation />, run: open('leadDesk'), keys: 'vp gm operation' },
      c('kpi') && { id: 'kpi', label: 'KPI', group: 'Analisa', icon: <IconTarget />, run: open('kpi') },
      c('kpi') && { id: 'kpiakt', label: tr('KPI Aktivitas'), group: 'Analisa', icon: <IconTarget />, run: open('activityKpi') },
      c('forecast') && { id: 'forecast', label: tr('Forecast'), group: 'Analisa', icon: <IconChartLine />, run: open('forecast') },
      // Admin
      role === 'admin' && { id: 'db', label: tr('Kelola Database'), group: 'Admin', icon: <IconDatabase />, run: open('database') },
      role === 'admin' && { id: 'users', label: tr('Kelola User'), group: 'Admin', icon: <IconUsers />, run: open('users'), keys: 'password reset akun' },
      role === 'admin' && { id: 'roles', label: tr('Kelola Role'), group: 'Admin', icon: <IconUsers />, run: open('roles'), keys: 'hak akses permission' },
      role === 'admin' && { id: 'ops', label: tr('Batas Waktu & Margin'), group: 'Admin', icon: <IconCheckSquare />, run: open('opsRules'), keys: 'eskalasi sla' },
      c('log') && { id: 'log', label: tr('Log Aktivitas'), group: 'Admin', icon: <IconActivity />, run: open('activity'), keys: 'audit riwayat' },
      // Data
      role === 'admin' && { id: 'import', label: tr('Import Excel'), group: 'Data', icon: <IconImport />, run: () => { useUiStore.setState({ importTarget: 'prospect' }); useUiStore.getState().openModal('import'); } },
      c('prospek', 'x') && { id: 'template', label: tr('Template'), group: 'Data', icon: <IconTemplate />, run: () => void downloadProspectTemplate(), keys: 'excel' },
      c('prospek', 'x') && { id: 'export', label: tr('Export Excel'), group: 'Data', icon: <IconExport />, run: () => void exportProspectsExcel(), keys: 'unduh download' },
      c('prospek', 'x') && { id: 'exportall', label: tr('Export Semua'), group: 'Data', icon: <IconDownload />, run: () => void exportAllExcel(), keys: 'unduh download' },
      { id: 'save', label: tr('Simpan Perubahan'), group: 'Data', icon: <IconSave />, run: () => void saveAllNow(), keys: 'sinkron refresh' },
      // Lainnya (tidak tampil di navigasi, hanya Ctrl+K)
      { id: 'notif', label: tr('Notifikasi'), group: 'Data', icon: <IconBell />, run: open('notifications') },
      { id: 'akun', label: tr('Akun Saya'), group: 'Data', icon: <IconUsers />, run: open('account'), keys: 'password username email' },
      { id: 'lama', label: tr('Tampilan lama'), group: 'Data', icon: <IconPresentation />, run: () => setDeskPref('lama'), keys: 'bar atas' },
      { id: 'keluar', label: tr('Keluar'), group: 'Data', icon: <IconUsers />, run: () => void logoutNow(router), keys: 'logout' },
    ];
    return out.filter(Boolean) as NavItem[];
  }, [me, perms, issues, rfqs, fupas, prospects, visitBadge, router, tr]);

  return { items, unread: notifications.filter((n) => !n.readAt).length };
}
