'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST } from '@/lib/constants';
import { formatRupiah, num } from '@/lib/format';
import { buildFollowUpRows } from '@/lib/reports';
import { buildTargetAchievement } from '@/lib/target-achievement';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import type { SalesActivity } from '@/lib/types';
import type { MobileTab } from './MobileShell';

interface TaskLite {
  id: string;
  customer: string;
  tujuan: string;
  dueDate: string;
  status: string;
  assigneeId: string;
  assignedByName: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const jt = (v: number) => (Math.abs(v) >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e6 ? `Rp ${Math.round(v / 1e6).toLocaleString('id-ID')} jt` : formatRupiah(v));

/** Hari Ini (HP): target & laju, follow-up jatuh tempo, tugas kunjungan, ringkasan minggu ini. */
export function MobileToday({ onVisit, onGo }: { onVisit: (customer: string, prospectId?: string) => void; onGo: (t: MobileTab) => void }) {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const seTargets = useDataStore((s) => s.seTargets);
  const openModal = useUiStore((s) => s.openModal);
  const [today] = useState(() => ymd(new Date()));
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [acts, setActs] = useState<SalesActivity[]>([]);

  useEffect(() => {
    let alive = true;
    api.get<{ tasks: TaskLite[] }>('/api/visit-tasks').then((r) => alive && setTasks(r.tasks)).catch(() => {});
    api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${today.slice(0, 7)}`).then((r) => alive && setActs(r.activities)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [today]);

  const sales = me?.role === 'sales';
  const ach = useMemo(
    () => buildTargetAchievement(prospects, budgetTargets, CABANG_LIST, { year: today.slice(0, 4), month: Number(today.slice(5, 7)), today, allProspects: sales }),
    [prospects, budgetTargets, today, sales],
  );
  const target = sales ? seTargets.filter((t) => (t.se || '').toUpperCase() === (me?.se || '').toUpperCase() && t.periode === today.slice(0, 7)).reduce((s, t) => s + num(t.amount), 0) : ach.target;
  const real = ach.real;
  const pct = target ? Math.round((real / target) * 100) : null;
  const onPace = target ? real >= target * ach.pace : null;
  const leftDays = Math.max(1, ach.workdays - ach.elapsed);
  const perDay = target && real < target ? (target - real) / leftDays : 0;

  const fu = buildFollowUpRows(prospects).filter((r) => r.source === 'terjadwal' && (r.prospect.followUpAt || '') <= today);
  const myTasks = tasks.filter((t) => t.status === 'ditugaskan' && (!sales || t.assigneeId === me?.id));
  const monday = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return ymd(d);
  })();
  const week = acts.filter((a) => a.tanggal >= monday && a.tanggal <= today && a.status !== 'rencana');
  const visits = week.filter((a) => a.tipe === 'kunjungan');
  const verified = visits.filter((a) => a.lat != null).length;
  const offers = week.filter((a) => a.tipe === 'dokumen').length;
  const newPo = prospects.filter((p) => num(p.status) >= 4 && num(p.status) <= 5 && (p.tglPO || '') >= monday).length;

  const dayName = new Date(`${today}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mb-page">
      <div className="mb-hello">
        <small>{dayName}</small>
        <b>{tr('Hari ini')}, {me?.name?.split(' ')[0]}</b>
      </div>

      <section className={`mb-card mb-target ${onPace === false ? 'warn' : ''}`}>
        <div className="mb-row">
          <span className="muted">{sales ? tr('Omzet saya bulan ini') : tr('Omzet bulan ini')}</span>
          {pct != null && <b className="mono">{pct}%</b>}
        </div>
        <b className="mb-big">{jt(real)} <small>/ {target ? jt(target) : tr('target belum diisi')}</small></b>
        {target > 0 && (
          <>
            <div className="mb-bar"><span style={{ width: `${Math.min(100, pct || 0)}%` }} /><i style={{ left: `${Math.min(100, ach.pace * 100)}%` }} /></div>
            <small className="muted">{onPace ? tr('Di atas laju') : tr('Di bawah laju')}{perDay ? ` · ${tr('perlu')} ${jt(perDay)} ${tr('per hari kerja')}` : ''}</small>
          </>
        )}
      </section>

      <section className="mb-card">
        <div className="mb-card-h"><b>{tr('Follow-up jatuh tempo')} · {fu.length}</b><button type="button" className="mb-link" onClick={() => openModal('followUpBoard')}>{tr('Semua')} →</button></div>
        {fu.length === 0 && <div className="mb-empty">{tr('Tidak ada follow-up hari ini.')}</div>}
        {fu.slice(0, 6).map((r) => (
          <div key={r.key} className="mb-item">
            <div className="mb-item-t">
              <b>{r.customer}</b>
              <small className={(r.prospect.followUpAt || '') < today ? 'bad' : ''}>{(r.prospect.followUpAt || '') < today ? tr('terlambat') : tr('hari ini')} · {r.prospect.followUpNote || r.reason}</small>
            </div>
            <div className="mb-item-a">
              <button type="button" className="mb-btn" onClick={() => { useUiStore.setState({ followUpCtx: { type: 'prospect', id: r.prospect.id } }); openModal('followUp'); }}>{tr('WA / Jadwal')}</button>
              <button type="button" className="mb-btn pri" onClick={() => onVisit(r.customer, r.prospect.id)}>{tr('Kunjungi')}</button>
            </div>
          </div>
        ))}
      </section>

      {myTasks.length > 0 && (
        <section className="mb-card">
          <div className="mb-card-h"><b>{tr('Tugas kunjungan')} · {myTasks.length}</b><button type="button" className="mb-link" onClick={() => openModal('visitTasks')}>{tr('Semua')} →</button></div>
          {myTasks.slice(0, 5).map((t) => (
            <div key={t.id} className="mb-item">
              <div className="mb-item-t">
                <b>{t.customer}</b>
                <small className={t.dueDate < today ? 'bad' : ''}>{t.tujuan} · {tr('tenggat')} {t.dueDate}{t.dueDate < today ? ` · ${tr('terlambat')}` : ''} · {tr('dari')} {t.assignedByName}</small>
              </div>
              {sales && <div className="mb-item-a"><button type="button" className="mb-btn pri" onClick={() => onVisit(t.customer)}>{tr('Laporkan')}</button></div>}
            </div>
          ))}
        </section>
      )}

      <section className="mb-card">
        <div className="mb-card-h"><b>{tr('Minggu ini')}</b><button type="button" className="mb-link" onClick={() => openModal('salesActivity')}>{tr('Aktivitas')} →</button></div>
        <div className="mb-stats">
          <div><b className="mono">{visits.length}</b><small>{tr('kunjungan')}</small><small className="muted">{verified} {tr('dengan lokasi')}</small></div>
          <div><b className="mono">{offers}</b><small>{tr('penawaran / dokumen')}</small></div>
          <button type="button" onClick={() => onGo('pipeline')}><b className="mono">{newPo}</b><small>{tr('PO baru')}</small></button>
        </div>
      </section>
    </div>
  );
}
