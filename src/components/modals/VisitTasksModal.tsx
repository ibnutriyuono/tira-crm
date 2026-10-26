'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { localToday } from '@/lib/sales-activity';
import { customerKey } from '@/lib/reports';
import {
  PLAN_STATUS_META,
  SARAN_VISIT,
  TUJUAN_PRESET,
  VISIT_VIEW_META,
  addDays,
  compliance,
  dayLabel,
  isOpenTask,
  mondayOf,
  visitView,
  weekLabel,
  type VisitPlan,
  type VisitPlanItem,
  type VisitTask,
} from '@/lib/visit-task';
import type { VisitSuggestion } from '@/lib/visit-task-server';
import { canAssignVisits } from '@/lib/roles';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { useRoster, type RosterUser } from '../issues/shared';
import { IconPlus, IconSearch } from '../icons';

let planSeq = 0;
const newPlanId = () => `p${Date.now().toString(36)}${(planSeq++).toString(36)}`;

type Tab = 'tugas' | 'rencana' | 'papan' | 'tugaskan' | 'persetujuan';
const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/**
 * Tugas Kunjungan & Rencana Kunjungan Mingguan.
 * Sales: tugas saya (laporkan / jadwal ulang) + rencana mingguan (ajukan ke BM).
 * BM / GM: papan tugas + kepatuhan, tugaskan (massal) + saran otomatis, persetujuan rencana.
 */
export function VisitTasksModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'visitTasks');
  const closeModal = useUiStore((s) => s.closeModal);
  const focus = useUiStore((s) => s.visitFocus);
  const me = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const today = localToday();
  const isSales = me?.role === 'sales';
  const boss = canAssignVisits(me?.role) || me?.role === 'admin';
  const tabs: [Tab, string][] = isSales
    ? [['tugas', 'Tugas saya'], ['rencana', 'Rencana mingguan']]
    : [['papan', 'Papan tugas'], ...(boss ? ([['tugaskan', 'Tugaskan & saran']] as [Tab, string][]) : []), ['persetujuan', 'Rencana mingguan Sales']];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const [tasks, setTasks] = useState<VisitTask[] | null>(null);
  const [plans, setPlans] = useState<VisitPlan[] | null>(null);

  const load = useCallback(() => {
    api.get<{ tasks: VisitTask[] }>('/api/visit-tasks').then((r) => setTasks(r.tasks)).catch((e) => toast(e.message, 'error'));
    api.get<{ plans: VisitPlan[] }>('/api/visit-plans').then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, [toast]);

  useEffect(() => {
    if (!show) return;
    load();
    const s = getSocket();
    const on = () => load();
    s.on('visitTask:updated', on);
    s.on('visitPlan:updated', on);
    return () => {
      s.off('visitTask:updated', on);
      s.off('visitPlan:updated', on);
    };
  }, [show, load]);

  useEffect(() => {
    if (!show || !focus) return;
    setTab(focus.kind === 'plan' ? (isSales ? 'rencana' : 'persetujuan') : isSales ? 'tugas' : 'papan');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, focus]);

  if (!show || !me) return null;
  const openCount = (tasks || []).filter((t) => isOpenTask(t) && (isSales ? t.assigneeId === me.id : true)).length;
  const pendingPlans = (plans || []).filter((p) => p.status === 'diajukan').length;

  return (
    <Modal show={show} onClose={closeModal} title={tr('Tugas Kunjungan')} xwide stickyHead footer={<button type="button" className="btn btn-outline" onClick={() => { useUiStore.setState({ visitFocus: null }); closeModal(); }}>{tr("Tutup")}</button>}>
      <div className="ea-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {tr(l)}
            {k === 'tugas' && openCount > 0 && <span className="item-chat-bubble">{openCount}</span>}
            {k === 'persetujuan' && pendingPlans > 0 && <span className="item-chat-bubble">{pendingPlans}</span>}
          </button>
        ))}
      </div>
      {!tasks ? (
        <div className="field-note">{tr("Memuat…")}</div>
      ) : (
        <>
          {tab === 'tugas' && <MyTasks tasks={tasks.filter((t) => t.assigneeId === me.id)} today={today} onChange={load} focusId={focus?.kind === 'task' ? focus.id : ''} />}
          {tab === 'rencana' && <MyPlan plans={(plans || []).filter((p) => p.userId === me.id)} today={today} onChange={load} />}
          {tab === 'papan' && <Board tasks={tasks} today={today} onChange={load} canManage={boss} focusId={focus?.kind === 'task' ? focus.id : ''} />}
          {tab === 'tugaskan' && <Assign tasks={tasks} today={today} onDone={() => { load(); setTab('papan'); }} />}
          {tab === 'persetujuan' && <PlanReview plans={plans || []} today={today} onChange={load} canReview={boss} />}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Sales */

function MyTasks({ tasks, today, onChange, focusId }: { tasks: VisitTask[]; today: string; onChange: () => void; focusId: string }) {
  const tr = useT();
  const [openId, setOpenId] = useState(focusId);
  const [mode, setMode] = useState<'lapor' | 'ulang'>('lapor');
  const open = tasks.filter(isOpenTask).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const late = open.filter((t) => t.dueDate < today);
  const todayList = open.filter((t) => t.dueDate === today);
  const week = open.filter((t) => t.dueDate > today && t.dueDate <= addDays(today, 7));
  const later = open.filter((t) => t.dueDate > addDays(today, 7));
  const done = tasks.filter((t) => !isOpenTask(t)).sort((a, b) => (b.reportedAt || b.updatedAt).localeCompare(a.reportedAt || a.updatedAt)).slice(0, 20);
  const group = (title: string, list: VisitTask[], cls = '') =>
    list.length > 0 && (
      <div className="vt-group">
        <div className={`vt-gtitle ${cls}`}>{tr(title)} · {list.length}</div>
        {list.map((t) => (
          <div key={t.id} className={`vt-card ${openId === t.id ? 'on' : ''}`}>
            <div className="vt-row">
              <div>
                <b>{t.customer}</b>
                <div className="muted">{t.tujuan}{t.catatan ? ` — ${t.catatan}` : ''}</div>
                <div className="muted">{tr("Ditugaskan oleh")} {t.assignedByName} ({t.assignedByRole.toUpperCase()}){t.planId ? ` · ${tr('dari rencana mingguan')}` : ''}</div>
              </div>
              <div className="vt-right">
                <span className={`badge ${VISIT_VIEW_META[visitView(t, today)].color}`}>{tr(VISIT_VIEW_META[visitView(t, today)].label)}</span>
                <div className="mono">{dayLabel(t.dueDate)}</div>
                <div className="vt-acts">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpenId(t.id); setMode('lapor'); }}>{tr("Laporkan kunjungan")}</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { setOpenId(t.id); setMode('ulang'); }}>{tr("Jadwal ulang")}</button>
                </div>
              </div>
            </div>
            {t.reschedules.length > 0 && <div className="muted vt-res">{tr("Dijadwal ulang")}: {t.reschedules.map((r) => `${r.from} → ${r.to} (${r.alasan})`).join(' · ')}</div>}
            {openId === t.id && (mode === 'lapor' ? <ReportForm t={t} today={today} onDone={() => { setOpenId(''); onChange(); }} /> : <RescheduleForm t={t} today={today} onDone={() => { setOpenId(''); onChange(); }} />)}
          </div>
        ))}
      </div>
    );
  return (
    <div>
      <div className="field-note" style={{ marginTop: 0 }}>{tr("Kunjungan yang Anda catat di Aktivitas Harian untuk customer yang sama otomatis menyelesaikan tugasnya. Tugas tidak bisa ditolak — jadwal ulang dengan alasan bila perlu.")}</div>
      {open.length === 0 && <div className="empty-state" style={{ padding: 24 }}>{tr("Tidak ada tugas kunjungan terbuka.")}</div>}
      {group('Terlambat', late, 'bad')}
      {group('Hari ini', todayList, 'today')}
      {group('7 hari ke depan', week)}
      {group('Berikutnya', later)}
      {done.length > 0 && (
        <div className="vt-group">
          <div className="vt-gtitle">{tr("Selesai / dibatalkan")}</div>
          <table className="simple-table" style={{ minWidth: 0 }}>
            <tbody>
              {done.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.customer}</b><div className="muted">{t.tujuan}</div></td>
                  <td><span className={`badge ${VISIT_VIEW_META[visitView(t, today)].color}`}>{tr(VISIT_VIEW_META[visitView(t, today)].label)}</span></td>
                  <td className="muted">{t.status === 'dilaporkan' ? `${(t.reportedAt || '').slice(0, 10)} — ${t.hasil || ''}` : t.cancelReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportForm({ t, today, onDone }: { t: VisitTask; today: string; onDone: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [tanggal, setTanggal] = useState(today);
  const [ket, setKet] = useState('');
  const [pics, setPics] = useState([{ nama: '', jabatan: '' }]);
  const [langkah, setLangkah] = useState('');
  const [geo, setGeo] = useState<{ lat: number; lng: number; akurasi: number } | null>(null);
  const [busy, setBusy] = useState(false);
  function locate() {
    if (!navigator.geolocation) return toast('Perangkat tidak mendukung lokasi', 'error');
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy }),
      () => toast('Lokasi tidak diizinkan', 'error'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  async function send() {
    setBusy(true);
    try {
      await api.patch(`/api/visit-tasks/${t.id}`, { action: 'lapor', tanggal, keterangan: ket, pics, langkah, ...(geo || {}) });
      toast(`Kunjungan ${t.customer} dilaporkan — tercatat di Aktivitas Harian`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vt-form">
      <div className="vt-grid">
        <label>{tr("Tanggal kunjungan")}<input type="date" value={tanggal} max={today} onChange={(e) => setTanggal(e.target.value)} /></label>
        <label>{tr("Lokasi (opsional)")}<button type="button" className="btn btn-outline btn-sm" onClick={locate}>{geo ? `✓ ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}` : tr('Ambil lokasi saya')}</button></label>
      </div>
      <label>{tr("Hasil kunjungan *")}<textarea rows={2} value={ket} onChange={(e) => setKet(e.target.value)} placeholder={tr("cth. Bertemu purchasing, minta revisi harga Creusabro 8000; kirim penawaran revisi besok.")} /></label>
      <label>{tr("PIC yang ditemui *")}</label>
      {pics.map((p, i) => (
        <div key={i} className="vd-row">
          <input type="text" value={p.nama} placeholder={tr("Nama")} onChange={(e) => setPics(pics.map((x, j) => (j === i ? { ...x, nama: e.target.value } : x)))} />
          <input type="text" value={p.jabatan} placeholder={tr("Jabatan")} onChange={(e) => setPics(pics.map((x, j) => (j === i ? { ...x, jabatan: e.target.value } : x)))} />
          {pics.length > 1 && <button type="button" className="icon-btn danger" onClick={() => setPics(pics.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => setPics([...pics, { nama: '', jabatan: '' }])}>+ {tr("PIC")}</button>
      <label>{tr("Langkah berikutnya")}<input type="text" value={langkah} onChange={(e) => setLangkah(e.target.value)} /></label>
      <div className="toolbar-row" style={{ marginBottom: 0 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>{tr("Kirim laporan")}</button>
        <span className="muted">{tr("Laporan kembali otomatis ke")} {t.assignedByName}.</span>
      </div>
    </div>
  );
}

function RescheduleForm({ t, today, onDone }: { t: VisitTask; today: string; onDone: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [due, setDue] = useState(addDays(t.dueDate < today ? today : t.dueDate, 1));
  const [alasan, setAlasan] = useState('');
  async function send() {
    try {
      await api.patch(`/api/visit-tasks/${t.id}`, { action: 'jadwal_ulang', dueDate: due, alasan });
      toast('Jadwal ulang tersimpan — penugas diberi tahu', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div className="vt-form">
      <div className="vt-grid">
        <label>{tr("Tanggal baru")}<input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} /></label>
        <label>{tr("Alasan *")}<input type="text" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder={tr("cth. PIC customer cuti sampai Kamis")} /></label>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={send}>{tr("Simpan jadwal ulang")}</button>
    </div>
  );
}

function MyPlan({ plans, today, onChange }: { plans: VisitPlan[]; today: string; onChange: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const thisMon = mondayOf(today);
  const [week, setWeek] = useState(addDays(thisMon, today >= addDays(thisMon, 4) ? 7 : 0));
  const plan = plans.find((p) => p.weekStart === week) || null;
  const [items, setItems] = useState<VisitPlanItem[]>(plan?.items || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => setItems(plan?.items || []), [plan?.id, plan?.updatedAt, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = plan?.status === 'diajukan' || plan?.status === 'disetujui';
  const custNames = useMemo(() => Array.from(new Set([...customers.map((c) => c.name), ...prospects.map((p) => p.customer)])).sort(), [customers, prospects]);
  const days = [0, 1, 2, 3, 4, 5].map((d) => addDays(week, d));
  const add = (date: string) => setItems([...items, { id: newPlanId(), date, customer: '', tujuan: TUJUAN_PRESET[0] }]);
  const set = (id: string, p: Partial<VisitPlanItem>) => setItems(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  async function save(submit: boolean) {
    setBusy(true);
    try {
      const withIds = items.map((x) => {
        const c = customers.find((cc) => customerKey(cc.name) === customerKey(x.customer));
        return { ...x, customerId: c?.id || null };
      });
      await api.post('/api/visit-plans', { weekStart: week, items: withIds, submit });
      toast(submit ? 'Rencana diajukan ke BM' : 'Draf rencana disimpan', 'success');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <datalist id="vt-cust">{custNames.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="toolbar-row">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, -7))}>‹</button>
        <b>{tr("Minggu")} {weekLabel(week)}</b>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, 7))}>›</button>
        {plan && <span className={`badge ${PLAN_STATUS_META[plan.status].color}`}>{tr(PLAN_STATUS_META[plan.status].label)}</span>}
        {plan?.reviewNote && <span className="muted">{plan.reviewedByName}: “{plan.reviewNote}”</span>}
      </div>
      <div className="vt-week">
        {days.map((d) => (
          <div key={d} className={`vt-day ${d === today ? 'today' : ''}`}>
            <div className="vt-day-h">{dayLabel(d)}</div>
            {items.filter((x) => x.date === d).map((x) => (
              <div key={x.id} className="vt-pi">
                <input type="text" list="vt-cust" value={x.customer} disabled={locked} placeholder={tr("Customer")} onChange={(e) => set(x.id, { customer: e.target.value })} />
                <input type="text" list="vt-tujuan" value={x.tujuan} disabled={locked} placeholder={tr("Tujuan")} onChange={(e) => set(x.id, { tujuan: e.target.value })} />
                {!locked && <button type="button" className="icon-btn danger" onClick={() => setItems(items.filter((y) => y.id !== x.id))}>×</button>}
              </div>
            ))}
            {!locked && <button type="button" className="link-btn" onClick={() => add(d)}>+ {tr("kunjungan")}</button>}
          </div>
        ))}
      </div>
      <datalist id="vt-tujuan">{TUJUAN_PRESET.map((x) => <option key={x} value={x} />)}</datalist>
      {!locked ? (
        <div className="toolbar-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => save(false)}>{tr("Simpan draf")}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !items.some((x) => x.customer.trim())} onClick={() => save(true)}>{tr("Ajukan ke BM")} ({items.filter((x) => x.customer.trim()).length})</button>
          <span className="muted">{tr("Setelah disetujui BM, tiap kunjungan menjadi tugas di tab Tugas saya.")}</span>
        </div>
      ) : (
        <div className="field-note">{plan?.status === 'diajukan' ? tr('Menunggu persetujuan BM — rencana tidak bisa diubah.') : tr('Rencana disetujui — kunjungannya ada di tab Tugas saya.')}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- BM / GM */

function Board({ tasks, today, onChange, canManage, focusId }: { tasks: VisitTask[]; today: string; onChange: () => void; canManage: boolean; focusId: string }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [f, setF] = useState<string>('aktif');
  const [sales, setSales] = useState('');
  const [cab, setCab] = useState('');
  const comp = useMemo(() => compliance(tasks, today), [tasks, today]);
  const cabangs = Array.from(new Set(tasks.map((t) => up(t.cabang)).filter(Boolean))).sort();
  const list = tasks
    .filter((t) => !sales || t.assigneeId === sales)
    .filter((t) => !cab || up(t.cabang) === cab)
    .filter((t) => (f === 'aktif' ? isOpenTask(t) : f === 'semua' ? true : visitView(t, today) === f))
    .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || a.dueDate.localeCompare(b.dueDate));
  const n = (v: string) => tasks.filter((t) => visitView(t, today) === v).length;
  const [cancel, setCancel] = useState<{ id: string; alasan: string } | null>(null);
  async function batal() {
    if (!cancel) return;
    try {
      await api.patch(`/api/visit-tasks/${cancel.id}`, { action: 'batal', alasan: cancel.alasan });
      setCancel(null);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div>
      <div className="pi-kpis">
        <button type="button" className={`pi-kpi ${f === 'aktif' ? 'on' : ''}`} onClick={() => setF('aktif')}><span className="lb">{tr("Terbuka")}</span><span className="n">{tasks.filter(isOpenTask).length}</span><span className="sub">{n('dijadwal_ulang')} {tr("dijadwal ulang")}</span></button>
        <button type="button" className={`pi-kpi bad ${f === 'terlambat' ? 'on' : ''}`} onClick={() => setF('terlambat')}><span className="lb">{tr("Terlambat")}</span><span className="n">{n('terlambat')}</span><span className="sub">{tr("lewat tenggat, belum dilaporkan")}</span></button>
        <button type="button" className={`pi-kpi ok ${f === 'dilaporkan' ? 'on' : ''}`} onClick={() => setF('dilaporkan')}><span className="lb">{tr("Dilaporkan")}</span><span className="n">{n('dilaporkan')}</span><span className="sub">{tr("90 hari terakhir")}</span></button>
        <div className="pi-kpi"><span className="lb">{tr("Kepatuhan")}</span><span className="n">{(() => { const tot = comp.reduce((s, c) => s + c.total, 0); const ok = comp.reduce((s, c) => s + c.tepat, 0); return tot ? `${Math.round((ok / tot) * 100)}%` : '–'; })()}</span><span className="sub">{tr("dilaporkan tepat waktu")}</span></div>
      </div>
      <div className="toolbar-row">
        <select value={f} onChange={(e) => setF(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="aktif">{tr("Terbuka")}</option>
          {Object.entries(VISIT_VIEW_META).map(([k, m]) => <option key={k} value={k}>{tr(m.label)}</option>)}
          <option value="semua">{tr("Semua")}</option>
        </select>
        <select value={sales} onChange={(e) => setSales(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">{tr("Semua Sales")}</option>
          {comp.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {cabangs.length > 1 && (
          <select value={cab} onChange={(e) => setCab(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">{tr("Semua cabang")}</option>
            {cabangs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      <div className="vt-board">
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead><tr><th>{tr("Customer")}</th><th>{tr("Sales")}</th><th>{tr("Tenggat")}</th><th>{tr("Status")}</th><th>{tr("Hasil / catatan")}</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="field-note">{tr("Tidak ada tugas pada saringan ini.")}</td></tr>}
              {list.map((t) => {
                const v = visitView(t, today);
                return (
                  <tr key={t.id} className={t.id === focusId ? 'vt-focus' : ''}>
                    <td><b>{t.customer}</b><div className="muted">{t.tujuan}{t.saran ? ` · ${tr('saran')}: ${tr(SARAN_VISIT[t.saran] || t.saran)}` : ''}{t.planId ? ` · ${tr('rencana mingguan')}` : ''}</div></td>
                    <td>{t.assigneeName}<div className="muted">{t.cabang} · {tr("oleh")} {t.assignedByName}</div></td>
                    <td className="mono">{dayLabel(t.dueDate)}{t.reschedules.length > 0 && <div className="muted" title={t.reschedules.map((r) => `${r.from}→${r.to}: ${r.alasan}`).join('\n')}>{tr("ulang")} {t.reschedules.length}× · {t.reschedules[t.reschedules.length - 1].alasan}</div>}</td>
                    <td><span className={`badge ${VISIT_VIEW_META[v].color}`}>{tr(VISIT_VIEW_META[v].label)}</span></td>
                    <td className="muted" style={{ maxWidth: 300 }}>{t.status === 'dilaporkan' ? `${(t.reportedAt || '').slice(0, 10)} — ${t.hasil || ''}` : t.cancelReason || t.catatan || ''}</td>
                    <td>
                      {canManage && isOpenTask(t) && cancel?.id !== t.id && <button type="button" className="btn btn-outline btn-sm" onClick={() => setCancel({ id: t.id, alasan: '' })}>{tr("Batalkan")}</button>}
                      {cancel?.id === t.id && (
                        <span className="vt-cancel">
                          <input type="text" autoFocus value={cancel.alasan} placeholder={tr("Alasan")} onChange={(e) => setCancel({ ...cancel, alasan: e.target.value })} />
                          <button type="button" className="btn btn-primary btn-sm" disabled={cancel.alasan.trim().length < 3} onClick={batal}>OK</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setCancel(null)}>×</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <div className="rq-title">{tr("Kepatuhan tugas per Sales")}</div>
          <table className="simple-table" style={{ minWidth: 0 }}>
            <thead><tr><th>{tr("Sales")}</th><th className="r">{tr("Tugas")}</th><th className="r">{tr("Tepat waktu")}</th><th className="r">{tr("Terlambat")}</th><th className="r">%</th></tr></thead>
            <tbody>
              {comp.length === 0 && <tr><td colSpan={5} className="field-note">-</td></tr>}
              {comp.map((c) => (
                <tr key={c.id}><td>{c.name}<div className="muted">{c.cabang}{c.ulang ? ` · ${c.ulang} ${tr('dijadwal ulang')}` : ''}</div></td><td className="r mono">{c.total}</td><td className="r mono">{c.tepat}</td><td className="r mono">{c.late ? <b style={{ color: 'var(--rust-600)' }}>{c.late}</b> : 0}</td><td className="r mono">{c.pct == null ? '–' : `${c.pct}%`}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Assign({ tasks, today, onDone }: { tasks: VisitTask[]; today: string; onDone: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const me = useDataStore((s) => s.currentUser);
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const roster = useRoster();
  const salesList = roster.filter((u: RosterUser & { se?: string | null }) => u.role === 'sales' && (me?.role !== 'bm' || up(u.cabang) === up(me?.cabang)));
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(addDays(today, 3));
  const [tujuan, setTujuan] = useState(TUJUAN_PRESET[0]);
  const [catatan, setCatatan] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ customer: string; customerId?: string | null; prospectId?: string | null; saran?: string }[]>([]);
  const [sugs, setSugs] = useState<VisitSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ suggestions: VisitSuggestion[] }>('/api/visit-tasks/suggest').then((r) => setSugs(r.suggestions)).catch(() => setSugs([]));
  }, []);
  const sel = salesList.find((u) => u.id === assignee) as (RosterUser & { se?: string | null }) | undefined;
  const custOptions = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const names = new Map<string, { customer: string; customerId: string | null }>();
    customers.forEach((c) => names.set(customerKey(c.name), { customer: c.name, customerId: c.id }));
    prospects.forEach((p) => !names.has(customerKey(p.customer)) && names.set(customerKey(p.customer), { customer: p.customer, customerId: null }));
    return Array.from(names.values()).filter((c) => c.customer.toLowerCase().includes(ql)).slice(0, 12);
  }, [q, customers, prospects]);
  const openKeys = new Set(tasks.filter(isOpenTask).map((t) => `${t.assigneeId}|${customerKey(t.customer)}`));
  const add = (c: (typeof picked)[number]) => !picked.some((x) => customerKey(x.customer) === customerKey(c.customer)) && setPicked([...picked, c]);

  async function send() {
    if (!assignee) return toast('Pilih Sales', 'error');
    setBusy(true);
    try {
      const r = await api.post<{ tasks: VisitTask[] }>('/api/visit-tasks', { assigneeId: assignee, dueDate: due, tujuan, catatan, customers: picked });
      toast(`${r.tasks.length} tugas kunjungan dikirim ke ${sel?.name || 'Sales'}`, 'success');
      setPicked([]);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function quick(s: VisitSuggestion) {
    const target = salesList.find((u) => up((u as RosterUser & { se?: string | null }).se) === up(s.se));
    if (!target) return toast('Sales pemilik customer ini tidak ditemukan — pilih manual di formulir', 'info');
    try {
      await api.post('/api/visit-tasks', { assigneeId: target.id, dueDate: addDays(today, 3), tujuan: s.tujuan, catatan: s.why, customers: [{ customer: s.customer, customerId: s.customerId, prospectId: s.prospectId, saran: s.saran }] });
      toast(`Ditugaskan ke ${target.name}: ${s.customer}`, 'success');
      setSugs((x) => (x || []).filter((y) => y.key !== s.key));
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="vt-assign">
      <div className="vt-col">
        <div className="rq-title">{tr("Tugaskan kunjungan")}</div>
        <label>{tr("Sales *")}
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{tr("— pilih Sales —")}</option>
            {salesList.map((u) => <option key={u.id} value={u.id}>{u.name}{(u as RosterUser & { se?: string | null }).se ? ` (${(u as RosterUser & { se?: string | null }).se})` : ''} · {u.cabang}</option>)}
          </select>
        </label>
        <label>{tr("Customer (bisa lebih dari satu) *")}
          <span className="pi-search"><IconSearch /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Cari customer…")} /></span>
        </label>
        {custOptions.length > 0 && (
          <div className="vr-vlist" style={{ maxHeight: 180 }}>
            {custOptions.map((c) => (
              <button key={c.customer} type="button" className="vt-opt" onClick={() => { add(c); setQ(''); }}>
                <IconPlus /> {c.customer}{assignee && openKeys.has(`${assignee}|${customerKey(c.customer)}`) ? <span className="muted"> · {tr("sudah ada tugas terbuka")}</span> : null}
              </button>
            ))}
          </div>
        )}
        <div className="vt-chips">
          {picked.map((c) => <span key={c.customer} className="vd-tag">{c.customer} <button type="button" className="link-btn" onClick={() => setPicked(picked.filter((x) => x !== c))}>×</button></span>)}
        </div>
        <div className="vt-grid">
          <label>{tr("Tenggat *")}<input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} /></label>
          <label>{tr("Tujuan *")}<input type="text" list="vt-tujuan2" value={tujuan} onChange={(e) => setTujuan(e.target.value)} /></label>
        </div>
        <datalist id="vt-tujuan2">{TUJUAN_PRESET.map((x) => <option key={x} value={x} />)}</datalist>
        <label>{tr("Catatan untuk Sales")}<input type="text" value={catatan} onChange={(e) => setCatatan(e.target.value)} /></label>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !assignee || !picked.length} onClick={send}>{tr("Tugaskan")} {picked.length ? `${picked.length} customer` : ''}</button>
        {me?.role === 'gm' && <div className="field-note" style={{ margin: 0 }}>{tr("Tugas dari GM langsung ke Sales; BM cabangnya ikut diberi tahu.")}</div>}
      </div>
      <div className="vt-col grow">
        <div className="rq-title">{tr("Saran otomatis")} {sugs ? `(${sugs.length})` : ''}</div>
        <div className="field-note" style={{ marginTop: 0 }}>{tr("Customer > 60 hari tidak dikunjungi, prospek besar tanpa kontak > 14 hari, masalah terbuka, dan Key Account jatuh tempo. Customer yang sudah punya tugas terbuka tidak ditampilkan.")}</div>
        {!sugs ? <div className="field-note">{tr("Memuat…")}</div> : sugs.length === 0 ? <div className="field-note">{tr("Tidak ada saran saat ini.")}</div> : (
          <table className="simple-table" style={{ minWidth: 0 }}>
            <tbody>
              {sugs.slice(0, 40).map((s) => (
                <tr key={s.key}>
                  <td><span className={`badge ${s.saran === 'masalah' ? 'rust' : s.saran === 'prospek' ? 'amber' : s.saran === 'kam' ? 'violet' : 'slate'}`}>{tr(SARAN_VISIT[s.saran])}</span></td>
                  <td><b>{s.customer}</b><div className="muted">{s.why} · {s.se || '-'} {s.cabang || ''}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => add({ customer: s.customer, customerId: s.customerId, prospectId: s.prospectId, saran: s.saran })}>+ {tr("ke formulir")}</button>{' '}
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => quick(s)} title={tr("Tugaskan ke Sales pemilik, tenggat 3 hari")}>{tr("Tugaskan")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PlanReview({ plans, today, onChange, canReview }: { plans: VisitPlan[]; today: string; onChange: () => void; canReview: boolean }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const me = useDataStore((s) => s.currentUser);
  const [week, setWeek] = useState(mondayOf(today));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = plans.filter((p) => p.status === 'diajukan');
  const shown = [...pending, ...plans.filter((p) => p.status !== 'diajukan' && p.weekStart === week)];
  async function act(p: VisitPlan, action: 'setuju' | 'tolak') {
    try {
      await api.patch(`/api/visit-plans/${p.id}`, { action, note: notes[p.id] || '' });
      toast(action === 'setuju' ? `Rencana ${p.userName} disetujui — ${p.items.length} tugas dibuat` : 'Rencana dikembalikan ke Sales', 'success');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  const mayReview = (p: VisitPlan) => canReview && (me?.role !== 'bm' || up(me?.cabang) === up(p.cabang));
  return (
    <div>
      <div className="toolbar-row">
        <span className="muted">{pending.length} {tr("rencana menunggu persetujuan")}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, -7))}>‹</button>
        <b>{weekLabel(week)}</b>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, 7))}>›</button>
      </div>
      {shown.length === 0 && <div className="empty-state" style={{ padding: 24 }}>{tr("Belum ada rencana kunjungan untuk minggu ini.")}</div>}
      {shown.map((p, i) => (
        <div key={`${p.id}-${i}`} className="vt-card">
          <div className="vt-row">
            <div>
              <b>{p.userName}</b> <span className="muted">{p.se} · {p.cabang}</span>
              <div className="muted">{weekLabel(p.weekStart)} · {p.items.length} {tr("kunjungan")}</div>
            </div>
            <span className={`badge ${PLAN_STATUS_META[p.status].color}`}>{tr(PLAN_STATUS_META[p.status].label)}</span>
          </div>
          <table className="simple-table" style={{ minWidth: 0, marginTop: 6 }}>
            <tbody>
              {[...p.items].sort((a, b) => a.date.localeCompare(b.date)).map((x) => (
                <tr key={x.id}><td className="mono" style={{ width: 120 }}>{dayLabel(x.date)}</td><td><b>{x.customer}</b></td><td className="muted">{x.tujuan}</td></tr>
              ))}
            </tbody>
          </table>
          {p.reviewNote && <div className="muted">{p.reviewedByName}: “{p.reviewNote}”</div>}
          {p.status === 'diajukan' && mayReview(p) && (
            <div className="vd-avl-act">
              <input type="text" value={notes[p.id] || ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} placeholder={tr("Catatan (wajib bila dikembalikan)")} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => act(p, 'setuju')}>{tr("Setujui")}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => act(p, 'tolak')}>{tr("Kembalikan")}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
