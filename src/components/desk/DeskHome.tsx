'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST, STAGE_PROBABILITY, STATUS_META } from '@/lib/constants';
import { buildCustomerAnalysis } from '@/lib/exec-more';
import { classify, formatDateID, num } from '@/lib/format';
import { isOpenIssue } from '@/lib/issues';
import { rfqAsWorkflowDoc, workflowStage } from '@/lib/purchasing-workflow';
import { buildAgingList } from '@/lib/reports';
import { bookingPeriode, buildTargetAchievement } from '@/lib/target-achievement';
import type { SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { rpShort } from '../analisa/ui';

interface TaskLite {
  id: string;
  customer: string;
  tujuan: string;
  dueDate: string;
  status: string;
  assigneeId: string;
  assigneeName?: string;
  assignedByName: string;
}

interface Todo {
  key: string;
  kind: 'fu' | 'tugas' | 'masalah' | 'rfq' | 'mangkrak' | 'kirim';
  late: boolean;
  sort: number;
  title: string;
  sub: string;
  when: string;
  actions: { label: string; run: () => void; pri?: boolean }[];
}

const KIND: Record<Todo['kind'], { label: string; cls: string }> = {
  fu: { label: 'Follow-up', cls: 'steel' },
  tugas: { label: 'Tugas kunjungan', cls: 'green' },
  masalah: { label: 'Masalah', cls: 'rust' },
  rfq: { label: 'Jawaban RFQ', cls: 'amber' },
  mangkrak: { label: 'Tidak bergerak', cls: 'slate' },
  kirim: { label: 'Penawaran belum dikirim', cls: 'amber' },
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00`).getTime()) / 86400000);

function Tile({ label, value, foot, tone = '', children, onClick }: { label: string; value: ReactNode; foot?: ReactNode; tone?: string; children?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`dk-tile ${tone}`} onClick={onClick}>
      <span className="l">{label}</span>
      <b className="v mono">{value}</b>
      {children}
      {foot && <small>{foot}</small>}
    </Tag>
  );
}

/** Beranda tampilan baru: "Hari ini untuk Anda". */
export function DeskHome({ onPage }: { onPage: (p: 'pipeline') => void }) {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const seTargets = useDataStore((s) => s.seTargets);
  const issues = useDataStore((s) => s.issues);
  const rfqs = useDataStore((s) => s.rfqs);
  const groups = useDataStore((s) => s.customerGroups);
  const [today] = useState(() => ymd(new Date()));
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [acts, setActs] = useState<SalesActivity[]>([]);
  const [showAll, setShowAll] = useState(false);
  const ym = today.slice(0, 7);
  const role = me?.role || '';
  const sales = role === 'sales';
  const manager = ['bm', 'rm', 'gm', 'vp', 'admin', 'gmops'].includes(role);

  useEffect(() => {
    let alive = true;
    api.get<{ tasks: TaskLite[] }>('/api/visit-tasks').then((r) => alive && setTasks(r.tasks || [])).catch(() => {});
    api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${ym}`).then((r) => alive && setActs(r.activities || [])).catch(() => {});
    return () => {
      alive = false;
    };
  }, [ym]);

  const openPanel = (id: string) => {
    onPage('pipeline');
    useUiStore.setState({ deskPanelId: id });
  };
  const open = useUiStore.getState().openModal;
  const fuModal = (id: string) => {
    useUiStore.setState({ followUpCtx: { type: 'prospect', id } });
    open('followUp');
  };

  // ---- angka utama
  const ach = useMemo(
    () => buildTargetAchievement(prospects, budgetTargets, CABANG_LIST, { year: today.slice(0, 4), month: Number(today.slice(5, 7)), today, allProspects: sales }),
    [prospects, budgetTargets, today, sales],
  );
  const target = sales ? seTargets.filter((t) => (t.se || '').toUpperCase() === (me?.se || '').toUpperCase() && t.periode === ym).reduce((s, t) => s + num(t.amount), 0) : ach.target;
  const pct = target ? Math.round((ach.real / target) * 100) : null;
  const onPace = target ? ach.real >= target * ach.pace : null;
  const leftDays = Math.max(1, ach.workdays - ach.elapsed);
  const perDay = target && ach.real < target ? (target - ach.real) / leftDays : 0;

  const active = prospects.filter((p) => classify(p) === 'Aktif');
  const pipeVal = active.reduce((s, p) => s + num(p.value), 0);
  const weighted = active.reduce((s, p) => s + num(p.value) * (STAGE_PROBABILITY[num(p.status)] || 0), 0);
  const fuDue = active.filter((p) => p.followUpAt && p.followUpAt <= today);
  const fuLate = fuDue.filter((p) => (p.followUpAt || '') < today);
  const noFu = active.filter((p) => !p.followUpAt);
  const unsent = active.filter((p) => num(p.status) >= 2 && !p.penawaranTerkirim);

  // ---- daftar kerja hari ini
  const todos = useMemo(() => {
    const out: Todo[] = [];
    fuDue.forEach((p) => {
      const late = (p.followUpAt || '') < today;
      out.push({
        key: `fu-${p.id}`,
        kind: 'fu',
        late,
        sort: late ? 0 : 2,
        title: p.customer,
        sub: [p.followUpNote, p.uraian, rpShort(num(p.value))].filter(Boolean).join(' · '),
        when: late ? `${tr('terlambat')} ${dayDiff(p.followUpAt as string, today)} ${tr('hari')}` : tr('hari ini'),
        actions: [
          { label: tr('Follow-up'), run: () => fuModal(p.id), pri: true },
          { label: tr('Buka'), run: () => openPanel(p.id) },
        ],
      });
    });
    tasks
      .filter((t) => t.status === 'ditugaskan' && (sales ? t.assigneeId === me?.id : t.dueDate <= today))
      .forEach((t) => {
        const late = t.dueDate < today;
        out.push({
          key: `t-${t.id}`,
          kind: 'tugas',
          late,
          sort: late ? 0 : 1,
          title: t.customer,
          sub: [t.tujuan, sales ? `${tr('dari')} ${t.assignedByName}` : t.assigneeName].filter(Boolean).join(' · '),
          when: late ? `${tr('lewat tenggat')} ${formatDateID(t.dueDate)}` : `${tr('tenggat')} ${formatDateID(t.dueDate)}`,
          actions: [{ label: tr('Buka tugas'), run: () => { useUiStore.setState({ visitFocus: { kind: 'task', id: t.id } }); open('visitTasks'); }, pri: true }],
        });
      });
    issues
      .filter((i) => (isOpenIssue(i) && i.pjIds.includes(me?.id || '')) || (i.status === 'usulan' && (role === 'admin' || (role === 'bm' && (i.cabang || '').toUpperCase() === (me?.cabang || '').toUpperCase()))))
      .forEach((i) => {
        const late = !!i.targetDate && i.targetDate < today;
        out.push({
          key: `i-${i.id}`,
          kind: 'masalah',
          late,
          sort: late ? 0 : 1,
          title: i.customer,
          sub: [i.status === 'usulan' ? tr('usulan menunggu keputusan Anda') : i.kategori, i.keterangan?.slice(0, 70)].filter(Boolean).join(' · '),
          when: i.targetDate ? `${tr('target')} ${formatDateID(i.targetDate)}` : '',
          actions: [{ label: tr('Tangani'), run: () => { useUiStore.setState({ issueFocus: { id: i.id } }); open('pipelineIssues'); }, pri: true }],
        });
      });
    const byId = new Map(prospects.map((p) => [p.id, p]));
    rfqs
      .filter((r) => !r.cancelledAt && r.prospectId && workflowStage(rfqAsWorkflowDoc(r)) === 3 && r.jawabanRfqAt && dayDiff(r.jawabanRfqAt, today) <= 7)
      .forEach((r) => {
        const p = byId.get(r.prospectId as string);
        if (!p || classify(p) !== 'Aktif') return;
        out.push({
          key: `r-${r.id}`,
          kind: 'rfq',
          late: false,
          sort: 1,
          title: p.customer,
          sub: `RFQ ${r.noRfq || ''} ${tr('sudah dijawab Purchasing')} · ${tr('lanjutkan ke penawaran')}`,
          when: formatDateID(r.jawabanRfqAt),
          actions: [
            { label: tr('Lihat jawaban'), run: () => { useUiStore.setState({ rfqCtx: { prospectId: p.id, rfqId: r.id } }); open('rfq'); }, pri: true },
            { label: tr('Buka'), run: () => openPanel(p.id) },
          ],
        });
      });
    unsent
      .filter((p) => p.tglPenawaran && dayDiff(p.tglPenawaran, today) >= 2)
      .forEach((p) =>
        out.push({
          key: `k-${p.id}`,
          kind: 'kirim',
          late: true,
          sort: 2,
          title: p.customer,
          sub: [p.uraian, rpShort(num(p.value))].filter(Boolean).join(' · '),
          when: `${tr('dibuat')} ${dayDiff(p.tglPenawaran as string, today)} ${tr('hari lalu')}`,
          actions: [
            { label: tr('Surat Penawaran'), run: () => { useUiStore.setState({ quotationProspectId: p.id }); open('quotation'); }, pri: true },
            { label: tr('Buka'), run: () => openPanel(p.id) },
          ],
        }),
      );
    buildAgingList(prospects)
      .filter(({ record }) => !record.followUpAt || record.followUpAt > today)
      .slice(0, 10)
      .forEach(({ record: p, days }) =>
        out.push({
          key: `a-${p.id}`,
          kind: 'mangkrak',
          late: false,
          sort: 3,
          title: p.customer,
          sub: [STATUS_META[num(p.status)]?.label, p.uraian, rpShort(num(p.value))].filter(Boolean).join(' · '),
          when: `${days} ${tr('hari tanpa progres')}`,
          actions: [
            { label: tr('Jadwalkan'), run: () => fuModal(p.id), pri: true },
            { label: tr('Buka'), run: () => openPanel(p.id) },
          ],
        }),
      );
    return out.sort((a, b) => a.sort - b.sort || Number(b.late) - Number(a.late));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospects, tasks, issues, rfqs, today, me, role, sales, tr]);

  // ---- deal yang bisa didorong
  const hot = [...active].filter((p) => num(p.status) >= 2).sort((a, b) => num(b.status) - num(a.status) || num(b.value) - num(a.value)).slice(0, 6);

  // ---- customer mulai hilang
  const lapsed = useMemo(() => buildCustomerAnalysis({ prospects, groups, range: { months: [ym], today } }).lapsed.slice(0, 5), [prospects, groups, ym, today]);

  // ---- tim (BM / RM / GM / VP / Admin)
  const team = useMemo(() => {
    if (!manager) return [];
    const monday = (() => {
      const d = new Date(`${today}T00:00:00`);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return ymd(d);
    })();
    const rows = new Map<string, { se: string; cabang: string; real: number; git: number; pipe: number; late: number; noFu: number; akt: number }>();
    const row = (se: string, cabang: string) => {
      const k = se.toUpperCase();
      if (!rows.has(k)) rows.set(k, { se: k, cabang, real: 0, git: 0, pipe: 0, late: 0, noFu: 0, akt: 0 });
      return rows.get(k)!;
    };
    prospects.forEach((p) => {
      if (!p.se) return;
      const r = row(p.se, p.cabang || '');
      const k = classify(p);
      if (k === 'Aktif') {
        r.pipe += num(p.value);
        if (!p.followUpAt) r.noFu += 1;
        else if (p.followUpAt < today) r.late += 1;
      }
      if (num(p.status) === 5 && bookingPeriode(p) === ym) {
        if (p.terfaktur) r.real += num(p.value);
        else r.git += num(p.value);
      }
    });
    acts.forEach((a) => {
      if (a.status === 'rencana' || a.tanggal < monday || a.tanggal > today || !a.se) return;
      const k = a.se.toUpperCase();
      if (rows.has(k)) rows.get(k)!.akt += 1;
    });
    return [...rows.values()].filter((r) => r.pipe || r.real || r.git || r.akt).sort((a, b) => b.real - a.real || b.pipe - a.pipe);
  }, [manager, prospects, acts, today, ym]);

  const hour = new Date().getHours();
  const greet = hour < 11 ? tr('Selamat pagi') : hour < 15 ? tr('Selamat siang') : hour < 18 ? tr('Selamat sore') : tr('Selamat malam');
  const dayName = new Date(`${today}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lateCount = todos.filter((t) => t.late).length;
  const shown = showAll ? todos : todos.slice(0, 12);

  return (
    <div className="dk-home">
      <div className="dk-hello">
        <div>
          <small>{dayName}</small>
          <h2>{greet}, {me?.name?.split(' ')[0]}</h2>
          <p>
            {todos.length ? (
              <>
                {tr('Ada')} <b>{todos.length}</b> {tr('hal untuk dikerjakan hari ini')}
                {lateCount > 0 && <>, <b className="dk-bad">{lateCount} {tr('sudah lewat waktu')}</b></>}.
              </>
            ) : (
              tr('Tidak ada yang mendesak hari ini.')
            )}
          </p>
        </div>
      </div>

      <div className="dk-tiles">
        <Tile label={sales ? tr('Omzet saya bulan ini') : tr('Omzet bulan ini')} value={rpShort(ach.real)} tone={onPace === false ? 'warn' : onPace ? 'ok' : ''} foot={target ? `${pct}% ${tr('dari')} ${rpShort(target)}${perDay ? ` · ${tr('perlu')} ${rpShort(perDay)}/${tr('hari kerja')}` : ''}` : tr('target belum diisi')}>
          {target > 0 && (
            <div className="dk-bar" title={`${tr('Laju seharusnya')} ${Math.round(ach.pace * 100)}%`}>
              <span style={{ width: `${Math.min(100, pct || 0)}%` }} />
              <i style={{ left: `${Math.min(100, ach.pace * 100)}%` }} />
            </div>
          )}
        </Tile>
        <Tile label={tr('Pipeline aktif')} value={rpShort(pipeVal)} foot={`${active.length} ${tr('prospek')} · ${tr('berbobot')} ${rpShort(weighted)}`} onClick={() => onPage('pipeline')} />
        <Tile label={tr('Follow-up jatuh tempo')} value={fuDue.length} tone={fuLate.length ? 'bad' : ''} foot={`${fuLate.length} ${tr('terlambat')} · ${noFu.length} ${tr('prospek tanpa jadwal')}`} onClick={() => open('followUpBoard')} />
        <Tile label={tr('Penawaran belum dikirim')} value={unsent.length} tone={unsent.length ? 'warn' : ''} foot={rpShort(unsent.reduce((s, p) => s + num(p.value), 0))} />
      </div>

      <div className="dk-cols">
        <section className="dk-card">
          <div className="dk-card-h">
            <b>{tr('Perlu dikerjakan')}</b>
            <span className="muted">{todos.length}</span>
          </div>
          {todos.length === 0 && <div className="dk-empty">{tr('Semua beres. Coba lihat deal terbesar di samping.')}</div>}
          <ul className="dk-todo">
            {shown.map((t) => (
              <li key={t.key} className={t.late ? 'late' : ''}>
                <span className={`dk-kind ${KIND[t.kind].cls}`}>{tr(KIND[t.kind].label)}</span>
                <div className="dk-todo-t">
                  <b>{t.title}</b>
                  <small>{t.sub}</small>
                </div>
                <span className={`dk-when${t.late ? ' dk-bad' : ''}`}>{t.when}</span>
                <div className="dk-todo-a">
                  {t.actions.map((a) => (
                    <button key={a.label} type="button" className={`btn btn-sm ${a.pri ? 'btn-primary' : 'btn-outline'}`} onClick={a.run}>{a.label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {todos.length > 12 && (
            <button type="button" className="dk-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? tr('Tampilkan lebih sedikit') : `${tr('Tampilkan semua')} (${todos.length})`}
            </button>
          )}
        </section>

        <div className="dk-side">
          <section className="dk-card">
            <div className="dk-card-h"><b>{tr('Deal paling dekat closing')}</b><button type="button" className="dk-link" onClick={() => onPage('pipeline')}>{tr('Pipeline')} →</button></div>
            {hot.length === 0 && <div className="dk-empty">{tr('Belum ada prospek di tahap penawaran.')}</div>}
            {hot.map((p) => (
              <button key={p.id} type="button" className="dk-deal" onClick={() => openPanel(p.id)}>
                <div>
                  <b>{p.customer}</b>
                  <small>{STATUS_META[num(p.status)]?.label} · {p.se || '-'}{p.followUpAt ? ` · FU ${formatDateID(p.followUpAt)}` : ` · ${tr('tanpa jadwal FU')}`}</small>
                </div>
                <b className="mono">{rpShort(num(p.value))}</b>
              </button>
            ))}
          </section>

          {lapsed.length > 0 && (
            <section className="dk-card">
              <div className="dk-card-h"><b>{tr('Customer mulai hilang')}</b><small className="muted">{tr('order terakhir 3–12 bln')}</small></div>
              {lapsed.map((c) => (
                <button key={c.name} type="button" className="dk-deal" onClick={() => { useUiStore.setState({ profileCustomer: c.name, profileReturnTo: null }); open('customerProfile'); }}>
                  <div>
                    <b>{c.name}</b>
                    <small>{c.cabang} · {tr('order terakhir')} {formatDateID(c.last)} ({c.days} {tr('hari')})</small>
                  </div>
                  <b className="mono">{rpShort(c.hist)}</b>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>

      {team.length > 0 && (
        <section className="dk-card">
          <div className="dk-card-h"><b>{tr('Tim saya bulan ini')}</b><small className="muted">{tr('aktivitas = pekan ini')}</small></div>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table ea-tbl">
              <thead>
                <tr>
                  <th>SE</th>
                  <th>{tr('Cabang')}</th>
                  <th className="r">{tr('Omzet')}</th>
                  <th className="r">GIT</th>
                  <th className="r">{tr('Pipeline')}</th>
                  <th className="r">{tr('FU terlambat')}</th>
                  <th className="r">{tr('Tanpa jadwal')}</th>
                  <th className="r">{tr('Aktivitas')}</th>
                </tr>
              </thead>
              <tbody>
                {team.slice(0, 40).map((r) => (
                  <tr key={r.se}>
                    <td><b>{r.se}</b></td>
                    <td>{r.cabang}</td>
                    <td className="r mono">{rpShort(r.real)}</td>
                    <td className="r mono">{rpShort(r.git)}</td>
                    <td className="r mono">{rpShort(r.pipe)}</td>
                    <td className={`r mono${r.late ? ' dk-bad' : ''}`}>{r.late}</td>
                    <td className={`r mono${r.noFu ? ' dk-warn' : ''}`}>{r.noFu}</td>
                    <td className={`r mono${r.akt === 0 ? ' dk-bad' : ''}`}>{r.akt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
