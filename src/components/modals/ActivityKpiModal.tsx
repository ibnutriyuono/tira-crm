'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { ACTIVITY_TYPES, type ActivityTipe } from '@/lib/constants';
import { buildActivityKpi, paceFor, prevPeriode, type ActivityKpiRow, type PaceSignal } from '@/lib/activity-kpi';
import { formatDateID, formatRupiah } from '@/lib/format';
import { isStaffActivityKey, localToday } from '@/lib/sales-activity';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { ActivityTarget, SalesActivity } from '@/lib/types';
import { useCan } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const PACE_META: Record<'on' | 'warn' | 'off', { label: string; badge: string; cls: string }> = {
  on: { label: 'Sesuai laju', badge: 'green', cls: 'on' },
  warn: { label: 'Sedikit tertinggal', badge: 'amber', cls: 'warn' },
  off: { label: 'Jauh tertinggal', badge: 'rust', cls: 'off' },
};
const paceMeta = (p: PaceSignal) => (p ? PACE_META[p] : null);
const STALE = 3;

function rpShort(n: number): string {
  if (n >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
  return formatRupiah(n);
}

type SortKey = 'pace' | 'score' | 'idle' | 'name';

/**
 * KPI Aktivitas: per-salesperson activity count vs target for one month, read
 * against the PACE (target so far = target x working days passed / working
 * days in the month) rather than the full-month target, plus discipline (days
 * with input, last input), results (into pipeline, depth, Rp) and the trend
 * against the same point of last month. Deliberately separate from the
 * weighted KPI Scorecard. Targets are editable by admin / GM / RM / BM only.
 */
export function ActivityKpiModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'activityKpi');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  const permKpiE = useCan('kpi', 'e');
  const canSetTarget = permKpiE && ['admin', 'gm', 'rm', 'bm'].includes(currentUser?.role || '');
  const today = localToday();

  const [periode, setPeriode] = useState(today.slice(0, 7));
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [prevActivities, setPrevActivities] = useState<SalesActivity[]>([]);
  const [targets, setTargets] = useState<ActivityTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSe, setEditSe] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortKey>('pace');
  const [group, setGroup] = useState(false);
  const [cabang, setCabang] = useState('');
  const [only, setOnly] = useState<'' | 'stale' | 'default'>('');
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(periode)) return;
    setLoading(true);
    try {
      const [a, p, t] = await Promise.all([
        api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${periode}`),
        api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${prevPeriode(periode)}`).catch(() => ({ activities: [] as SalesActivity[] })),
        api.get<{ targets: ActivityTarget[] }>(`/api/activity-targets?periode=${periode}`),
      ]);
      setActivities(a.activities);
      setPrevActivities(p.activities);
      setTargets(t.targets);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat KPI aktivitas', 'error');
    } finally {
      setLoading(false);
    }
  }, [periode, toast]);

  useEffect(() => {
    if (show) {
      setEditSe(null);
      setSel(null);
      void load();
    }
  }, [show, load]);

  const pi = useMemo(() => paceFor(periode, today), [periode, today]);

  // Managers also see SEs with no activity/target yet (known from the pipeline
  // they can already see), so a quiet SE shows as 0% instead of vanishing.
  const allRows = useMemo(() => {
    const known = new Map<string, ActivityTarget>();
    targets.forEach((t) => known.set(t.se.toLowerCase(), t));
    if (canSetTarget) {
      prospects.forEach((p) => {
        const se = (p.se || '').trim();
        if (se && !known.has(se.toLowerCase())) {
          known.set(se.toLowerCase(), { id: '', se, periode, cabang: p.cabang, reg: p.reg, targets: {}, updatedBy: null });
        }
      });
    }
    // Aktivitas GM / RM / Admin / Admin Sales / Purchasing tampil di Aktivitas
    // Harian masing-masing, tetapi tidak dihitung sebagai baris KPI Sales.
    const field = (list: typeof activities) => list.filter((a) => !isStaffActivityKey(a.se));
    return buildActivityKpi(field(activities), Array.from(known.values()).filter((t) => !isStaffActivityKey(t.se)), prospects, { periode, today, prevActivities: field(prevActivities) });
  }, [activities, prevActivities, targets, prospects, periode, today, canSetTarget]);

  const isDefault = (r: ActivityKpiRow) => r.types.every((t) => !t.targetSet);
  const isStale = (r: ActivityKpiRow) => pi.elapsed > 0 && (r.idleWorkdays == null || r.idleWorkdays >= STALE);
  const cabangs = useMemo(() => Array.from(new Set(allRows.map((r) => (r.cabang || '-').toUpperCase()))).sort(), [allRows]);

  const rows = useMemo(() => {
    const list = allRows
      .filter((r) => !cabang || (r.cabang || '-').toUpperCase() === cabang)
      .filter((r) => (only === 'stale' ? isStale(r) : only === 'default' ? isDefault(r) : true));
    const by: Record<SortKey, (a: ActivityKpiRow, b: ActivityKpiRow) => number> = {
      pace: (a, b) => (a.paceRatio ?? 0) - (b.paceRatio ?? 0),
      score: (a, b) => (b.overall ?? 0) - (a.overall ?? 0),
      idle: (a, b) => (b.idleWorkdays ?? 999) - (a.idleWorkdays ?? 999),
      name: (a, b) => a.se.localeCompare(b.se),
    };
    return list.sort((a, b) => by[sort](a, b) || a.se.localeCompare(b.se));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, cabang, only, sort, pi.elapsed]);

  const grouped = useMemo(() => {
    if (!group) return [{ cabang: '', rows }];
    const m = new Map<string, ActivityKpiRow[]>();
    rows.forEach((r) => {
      const c = (r.cabang || '-').toUpperCase();
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(r);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([c, list]) => ({ cabang: c, rows: list }));
  }, [rows, group]);

  const scope = allRows.filter((r) => !cabang || (r.cabang || '-').toUpperCase() === cabang);
  const onTrack = scope.filter((r) => r.pace === 'on').length;
  const stale = scope.filter(isStale);
  const defaults = scope.filter(isDefault);
  const teamDone = scope.reduce((s, r) => s + r.types.reduce((x, t) => x + t.result, 0), 0);
  const teamTarget = scope.reduce((s, r) => s + r.types.reduce((x, t) => x + t.target, 0), 0);
  const teamPipe = scope.reduce((s, r) => s + r.converted, 0);
  const teamRp = scope.reduce((s, r) => s + r.pipelineValue, 0);

  const selRow = sel ? allRows.find((r) => r.se === sel) || null : null;
  const selActs = useMemo(
    () => (sel ? activities.filter((a) => a.se.trim().toLowerCase() === sel.toLowerCase() && a.status !== 'rencana').sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.createdAt.localeCompare(a.createdAt)).slice(0, 8) : []),
    [activities, sel],
  );

  function startEdit(se: string, current: Record<ActivityTipe, number>) {
    setEditSe(se);
    setDraft(Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, String(current[t.key])])));
  }

  async function saveTarget() {
    if (!editSe) return;
    const payload: Record<string, number> = {};
    for (const t of ACTIVITY_TYPES) {
      const n = Number(draft[t.key]);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return toast(`Target ${t.label} harus bilangan bulat 0–9999`, 'error');
      payload[t.key] = n;
    }
    setSaving(true);
    try {
      await api.put('/api/activity-targets', { se: editSe, periode, targets: payload });
      toast('Target aktivitas disimpan', 'success');
      setEditSe(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan target', 'error');
    } finally {
      setSaving(false);
    }
  }

  const curTargets = (r: ActivityKpiRow) => Object.fromEntries(r.types.map((t) => [t.tipe, t.target])) as Record<ActivityTipe, number>;
  const pacePctLabel = Math.round(pi.pace * 100);
  const idleText = (r: ActivityKpiRow) => (r.idleWorkdays == null ? 'Belum ada' : r.idleWorkdays === 0 ? (r.lastDate === today ? 'Hari ini' : formatDateID(r.lastDate)) : `${r.idleWorkdays} hari kerja lalu`);
  const idleBadge = (r: ActivityKpiRow) => (r.idleWorkdays == null || r.idleWorkdays >= STALE ? 'rust' : r.idleWorkdays >= 2 ? 'amber' : 'green');

  const colCount = 11 + (canSetTarget ? 1 : 0);

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("KPI Aktivitas Sales")}
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          {tr("Tutup")}
        </button>
      }
    >
      <div className="toolbar-row" style={{ marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <label style={{ margin: 0 }}>{tr("Periode")}</label>
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
        <span className="ak-pace">
          <span>
            {tr("Hari kerja ke-")}<b>{pi.elapsed}</b> {tr("dari")} <b>{pi.days.length}</b>
          </span>
          <span className="ak-pace-bar" aria-hidden="true">
            <span style={{ width: `${pacePctLabel}%` }} />
          </span>
          <span>
            {tr("Laju target")} <b>{pacePctLabel}%</b>
          </span>
        </span>
        {loading && <span className="field-note">{tr("Memuat…")}</span>}
      </div>

      <div className="kpi-grid">
        <div className="kpi won">
          <div className="label">{tr("Sesuai laju")}</div>
          <div className="value">
            {onTrack} / {scope.length} SE
          </div>
          <div className="foot">{tr("Capaian ≥ target s.d. hari ini")}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Aktivitas tim")}</div>
          <div className="value">
            {teamDone} / {Math.round(teamTarget * pi.pace)}
          </div>
          <div className="foot">{tr("vs target s.d. hari ini (bulan:")} {teamTarget})</div>
        </div>
        <div className="kpi lost">
          <div className="label">{tr("Belum input ≥")}{STALE} {tr("hari kerja")}</div>
          <div className="value">{stale.length} SE</div>
          <div className="foot">
            {stale.slice(0, 6).map((r) => r.se).join(', ') || tr("Semua aktif")}
            {stale.length > 0 && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => setOnly(only === 'stale' ? '' : 'stale')}>
                  {only === 'stale' ? tr("tampilkan semua") : 'tampilkan'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Target masih default")}</div>
          <div className="value">{defaults.length} SE</div>
          <div className="foot">
            {tr("Persentase belum mencerminkan target nyata")}
            {canSetTarget && defaults.length > 0 && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => setOnly(only === 'default' ? '' : 'default')}>
                  {only === 'default' ? tr("tampilkan semua") : tr("atur target")}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="kpi aktif">
          <div className="label">{tr("Aktivitas → pipeline")}</div>
          <div className="value">{teamPipe} {tr("prospek")}</div>
          <div className="foot" title={formatRupiah(teamRp)}>
            {rpShort(teamRp)} {tr("nilai pipeline")}
          </div>
        </div>
      </div>

      <div className="toolbar-row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={tr("Urutkan")} style={{ maxWidth: 230 }}>
            <option value="pace">{tr("Urutkan: paling tertinggal")}</option>
            <option value="score">{tr("Urutkan: skor tertinggi")}</option>
            <option value="idle">{tr("Urutkan: input terlama")}</option>
            <option value="name">{tr("Urutkan: SE A–Z")}</option>
          </select>
          <button type="button" className={`btn btn-sm ${group ? 'btn-primary' : 'btn-outline'}`} onClick={() => setGroup((g) => !g)}>
            {tr("Kelompokkan per cabang")}
          </button>
          {cabangs.length > 1 && (
            <select value={cabang} onChange={(e) => setCabang(e.target.value)} aria-label={tr("Cabang")} style={{ maxWidth: 160 }}>
              <option value="">{tr("Semua cabang")}</option>
              {cabangs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {only && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setOnly('')}>
              {tr("Filter:")} {only === 'stale' ? tr("belum input") : tr("target default")} ✕
            </button>
          )}
        </div>
        <span className="ak-legend">
          <span><i className="on" />{tr("Sesuai laju")}</span>
          <span><i className="warn" />{tr("Sedikit tertinggal")}</span>
          <span><i className="off" />{tr("Jauh tertinggal")}</span>
          <span><i className="mark" />{tr("Seharusnya s.d. hari ini")}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">{tr("Belum ada aktivitas atau target pada periode ini.")}</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table ak-table" style={{ minWidth: 1100 }}>
            <thead>
              <tr className="ak-grp">
                <th />
                <th colSpan={ACTIVITY_TYPES.length}>{tr("Aktivitas (capaian ÷ target bulan)")}</th>
                <th>{tr("Laju")}</th>
                <th colSpan={2}>{tr("Kedisiplinan")}</th>
                <th colSpan={2}>{tr("Hasil")}</th>
                <th>{tr("Tren")}</th>
                {canSetTarget && <th />}
              </tr>
              <tr>
                <th>SE</th>
                {ACTIVITY_TYPES.map((t) => (
                  <th key={t.key} title={t.label}>
                    {t.short}
                  </th>
                ))}
                <th>{tr("Skor vs laju")}</th>
                <th title={tr("Hari kerja dengan minimal satu aktivitas")}>{tr("Hari aktif")}</th>
                <th>{tr("Input terakhir")}</th>
                <th title={tr("Aktivitas yang dimasukkan ke pipeline")}>{tr("Ke pipeline")}</th>
                <th title={tr("Dari aktivitas yang masuk pipeline: sampai Permintaan · Penawaran · PO/DO (status terkini)")}>{tr("Minta · Tawar · PO")}</th>
                <th title={tr("Jumlah aktivitas dibanding bulan lalu pada hari kerja yang sama")}>{tr("vs bln lalu")}</th>
                {canSetTarget && <th />}
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <GroupRows key={g.cabang || 'all'} g={g} group={group} colCount={colCount}>
                  {g.rows.map((r) => {
                    const pm = paceMeta(r.pace);
                    const trend = r.prevTotal ? Math.round((r.total / r.prevTotal - 1) * 100) : null;
                    return (
                      <tr key={r.se} className={`ak-row${sel === r.se ? ' sel' : ''}`} onClick={() => setSel(sel === r.se ? null : r.se)} title={`Klik untuk detail ${r.se}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <strong>{r.se}</strong>
                          {r.cabang && <div className="field-note" style={{ margin: 0 }}>{r.cabang}</div>}
                        </td>
                        {r.types.map((t) => {
                          const m = paceMeta(t.pace);
                          return (
                            <td key={t.tipe} style={{ minWidth: 92 }}>
                              <span className="ak-bar" aria-hidden="true">
                                <span className={`fill ${m?.cls || ''}${t.targetSet ? '' : ' def'}`} style={{ width: `${Math.min(100, Math.round((t.achieve || 0) * 100))}%` }} />
                                <span className="mark" style={{ left: `${pacePctLabel}%` }} />
                              </span>
                              <span className="ak-val">
                                <span className="mono">
                                  {t.result}/{t.target}
                                </span>
                                {t.targetSet ? <span className={`ak-pct ${m?.cls || ''}`}>{pct(t.achieve)}</span> : <span className="ak-def" title={tr("Target default — belum diatur manajer")}>{tr("default")}</span>}
                              </span>
                            </td>
                          );
                        })}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {pm ? <span className={`badge ${pm.badge}`}>{pm.label}</span> : <span className="badge slate">-</span>}
                          <div className="field-note" style={{ margin: '3px 0 0' }}>{tr("skor")} {pct(r.overall)}</div>
                        </td>
                        <td>
                          <span className="ak-cal" aria-hidden="true">
                            {r.dayFlags.map((on, i) => (
                              <span key={i} className={i >= pi.elapsed ? 'future' : on ? 'on' : ''} title={pi.days[i]} />
                            ))}
                          </span>
                          <div className="field-note" style={{ margin: '3px 0 0' }}>
                            {r.activeDays} / {pi.elapsed} {tr("hari")}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${idleBadge(r)}`}>{idleText(r)}</span>
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                          {r.converted}/{r.total} ({pct(r.conversionRate)})
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="mono">
                            {r.toRequest} → {r.toQuote} → <b>{r.toPo}</b>
                          </span>
                          {r.pipelineValue > 0 && <div className="field-note" style={{ margin: 0 }}>{rpShort(r.pipelineValue)} {tr("di pipeline")}</div>}
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap', fontWeight: 700, color: trend == null ? 'var(--text-soft)' : trend >= 0 ? 'var(--green-600)' : 'var(--rust-600)' }} title={r.prevTotal != null ? `Bulan lalu s.d. hari kerja yang sama: ${r.prevTotal} aktivitas` : ''}>
                          {trend == null ? (r.prevTotal === 0 && r.total > 0 ? tr("Baru") : '–') : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend)}%`}
                        </td>
                        {canSetTarget && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ whiteSpace: 'nowrap' }}
                              title={tr("Atur target aktivitas SE ini")}
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(r.se, curTargets(r));
                              }}
                            >
                              {tr("Target")}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editSe && (
        <div className="rfq-item-card" style={{ marginTop: 12 }}>
          <div className="rfq-item-head">
            <strong>
              {tr("Target")} {editSe} — {periode}
            </strong>
          </div>
          <div className="form-grid">
            {ACTIVITY_TYPES.map((t) => (
              <div key={t.key}>
                <label>
                  {t.label} ({t.unit})
                </label>
                <input type="number" min={0} max={9999} step={1} value={draft[t.key] ?? ''} onChange={(e) => setDraft({ ...draft, [t.key]: e.target.value })} />
              </div>
            ))}
            <div className="full">
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={saveTarget}>
                {tr("Simpan target")}
              </button>{' '}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditSe(null)}>
                {tr("Batal")}
              </button>
            </div>
          </div>
        </div>
      )}

      {selRow && (
        <div className="ak-detail">
          <div className="ak-detail-head">
            <b>
              {tr("Detail")} {selRow.se}
              {selRow.cabang ? ` · ${selRow.cabang}` : ''}
            </b>
            <span style={{ display: 'flex', gap: 8 }}>
              {canSetTarget && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => startEdit(selRow.se, curTargets(selRow))}>
                  {tr("Atur target")}
                </button>
              )}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setSel(null)}>
                {tr("Tutup detail")}
              </button>
            </span>
          </div>
          <div className="ak-detail-body">
            <div className="ak-quality">
              <b style={{ fontSize: 13 }}>{tr("Kualitas aktivitas")}</b>
              {[
                { label: 'Aktivitas dengan PIC & jabatan', v: selRow.picRate, text: pct(selRow.picRate) },
                { label: 'Aktivitas jadi prospek', v: selRow.conversionRate, text: pct(selRow.conversionRate) },
                { label: 'Hari aktif dari hari kerja berlalu', v: pi.elapsed ? selRow.activeDays / pi.elapsed : null, text: `${selRow.activeDays} / ${pi.elapsed}` },
              ].map((q) => (
                <div key={q.label}>
                  <div className="ak-q-row">
                    <span>{q.label}</span>
                    <b className="mono">{q.text}</b>
                  </div>
                  <span className="ak-q-bar">
                    <span className={q.v == null ? '' : q.v >= 0.7 ? 'on' : q.v >= 0.4 ? 'warn' : 'off'} style={{ width: `${Math.round(Math.min(1, q.v || 0) * 100)}%` }} />
                  </span>
                </div>
              ))}
              <div className="field-note" style={{ margin: 0 }}>
                {selRow.customers} {tr("customer berbeda dikunjungi/dihubungi bulan ini.")}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{tr("Aktivitas terakhir")}</b>
              {selActs.length === 0 ? (
                <div className="field-note">{tr("Belum ada aktivitas pada periode ini.")}</div>
              ) : (
                <div className="table-wrap" style={{ borderTop: 'none', marginTop: 6 }}>
                  <table className="simple-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>{tr("Tanggal")}</th>
                        <th>{tr("Jenis")}</th>
                        <th>{tr("Customer")}</th>
                        <th>PIC</th>
                        <th>{tr("Pipeline")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selActs.map((a) => (
                        <tr key={a.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDateID(a.tanggal)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{ACTIVITY_TYPES.find((t) => t.key === a.tipe)?.short || a.tipe}</td>
                          <td>{a.customer}</td>
                          <td style={{ fontSize: 12 }}>{(a.pics || []).filter((p) => p.nama).map((p) => (p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)).join(', ') || <span className="field-note">{tr("belum diisi")}</span>}</td>
                          <td>{a.prospectId ? <span className="badge green">{tr("Di pipeline")}</span> : <span className="badge slate">{tr("Belum")}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="field-note" style={{ marginTop: 10 }}>
        {tr("Capaian = jumlah aktivitas ÷ target bulan per jenis. Warna mengikuti")} <b>{tr("laju")}</b>{tr(": capaian dibanding target s.d. hari kerja ini (Senin–Jumat), bukan target sebulan penuh — hijau ≥95%, kuning 60–95%, merah di bawahnya. Skor = rata-rata capaian tiap jenis (maks. 100%). Target bertanda \"default\" belum diatur manajer. Konversi dihitung dari status terkini prospek hasil klik tombol di Aktivitas Harian. Terpisah dari KPI Scorecard.")}
      </div>
    </Modal>
  );
}

function GroupRows({ g, group, colCount, children }: { g: { cabang: string; rows: ActivityKpiRow[] }; group: boolean; colCount: number; children: React.ReactNode }) {
  const tr = useT();
  if (!group) return <>{children}</>;
  const on = g.rows.filter((r) => r.pace === 'on').length;
  const conv = g.rows.reduce((s, r) => s + r.converted, 0);
  const po = g.rows.reduce((s, r) => s + r.toPo, 0);
  return (
    <>
      <tr className="ak-group">
        <td colSpan={colCount}>
          {tr("Cabang")} {g.cabang} · {g.rows.length} {tr("SE ·")} {on} {tr("sesuai laju · ke pipeline")} {conv} {tr("· PO")} {po}
        </td>
      </tr>
      {children}
    </>
  );
}
