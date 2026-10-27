'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import { AGING_THRESHOLD_DAYS, CABANG_LIST, STATUS_META } from '@/lib/constants';
import { buildAgingList, buildForecast, buildForecastByReg, buildForecastBySe, buildForecastNasional } from '@/lib/reports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { buildSalesPlanDetail, canEditSalesPlanFor } from '@/lib/sales-plan-view';
import { IconTrash } from '../icons';
import type { AnnualTarget, BudgetTarget, RosterUser, SalesPlan } from '@/lib/types';
import { SeTargetSection, buildAllocations } from '../forecast/SeTargetSection';
import { seTargetOf } from '@/lib/se-target';
import { yearMonthTarget } from '@/lib/kpi';
import { useCan } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
import { isGmLevel } from '@/lib/roles';
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const labelPeriode = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1] || ''} ${p.slice(0, 4)}`;
/** 1165999999 -> "1.165.999.999" */
const dots = (n: number) => (n ? Math.round(n).toLocaleString('id-ID') : '');

/**
 * Target input with thousand dots. A carried-forward target (no entry for
 * this month yet) is shown as the value with a "dari <bulan>" note; typing a
 * different amount saves it for this month only.
 */
function TargetInput({ value, from, note, onSave }: { value: number; from: string | null; note?: string; onSave: (v: number) => void }) {
  const tr = useT();
  const [text, setText] = useState(dots(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    // Periode switched or the target changed elsewhere: show the new value.
    setSynced(value);
    setText(dots(value));
  }
  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          setText(digits ? Number(digits).toLocaleString('id-ID') : '');
        }}
        onBlur={() => {
          const v = Number(text.replace(/\D/g, '')) || 0;
          if (v !== value) onSave(v);
        }}
        placeholder="0"
        style={{ maxWidth: 170, textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono), monospace', color: from ? 'var(--text-soft)' : undefined }}
      />
      {from && <div className="field-note" style={{ marginTop: 2 }}>{tr("dari")} {labelPeriode(from)}</div>}
      {!from && note && <div className="field-note" style={{ marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function currentPeriode(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ForecastModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'forecast';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const records = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const annualTargets = useDataStore((s) => s.annualTargets);
  const upsertAnnualTarget = useDataStore((s) => s.upsertAnnualTarget);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const upsertBudgetTarget = useDataStore((s) => s.upsertBudgetTarget);
  const upsertSalesPlan = useDataStore((s) => s.upsertSalesPlan);
  const removeSalesPlan = useDataStore((s) => s.removeSalesPlan);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [periode, setPeriode] = useState(currentPeriode());
  const [planCabang, setPlanCabang] = useState('');
  const [deleting, setDeleting] = useState('');
  const seTargets = useDataStore((s) => s.seTargets);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  useEffect(() => {
    if (!show) return;
    let alive = true;
    api
      .get<{ roster: RosterUser[] }>('/api/users/roster')
      .then((r) => alive && setRoster(r.roster))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  // rm may only set targets for branches inside their own region; the region of
  // a branch is only knowable from the prospect rows.
  const cabangReg = useMemo(() => {
    const m: Record<string, number | null> = {};
    records.forEach((r) => {
      const cb = (r.cabang || '').toUpperCase();
      if (cb && m[cb] == null) m[cb] = r.reg;
    });
    return m;
  }, [records]);

  const permE = useCan('forecast', 'e');
  const permRencanaE = useCan('rencana', 'e');
  const permRencanaD = useCan('rencana', 'd');
  const canEdit = (cabang: string) => {
    if (!currentUser || !permE) return false;
    if (currentUser.role === 'admin' || isGmLevel(currentUser.role)) return true;
    if (currentUser.role === 'rm') return cabangReg[cabang.toUpperCase()] === currentUser.reg;
    if (currentUser.role === 'bm') return (currentUser.cabang || '').toUpperCase() === cabang.toUpperCase();
    return false;
  };

  const rows = useMemo(() => buildForecast(records, budgetTargets, periode, CABANG_LIST, salesPlans), [records, budgetTargets, periode, salesPlans]);
  const seRows = useMemo(() => buildForecastBySe(records, periode), [records, periode]);
  // seRows only lists SEs with prospect activity this period; an SE who
  // filled in a plan but has no pipeline movement yet would otherwise be
  // invisible here entirely, silently hiding their Rencana.
  const seRencana = useMemo(() => {
    const m = new Map<string, number>();
    salesPlans.filter((p) => p.periode === periode).forEach((p) => m.set(p.se.toUpperCase(), num(p.value)));
    return m;
  }, [salesPlans, periode]);
  const seList = useMemo(() => {
    const known = new Set(seRows.map((r) => r.se));
    const extra = Array.from(seRencana.keys())
      .filter((se) => !known.has(se))
      .map((se) => {
        const plan = salesPlans.find((p) => p.se.toUpperCase() === se && p.periode === periode);
        return { se, cabang: plan?.cabang || '-', won: 0, weighted: 0, openCount: 0, wonCount: 0 };
      });
    return [...seRows, ...extra].sort((a, b) => (seRencana.get(b.se) || 0) - (seRencana.get(a.se) || 0) || b.won - a.won);
  }, [seRows, seRencana, salesPlans, periode]);
  const regRows = useMemo(() => buildForecastByReg(rows), [rows]);
  const nasional = useMemo(() => buildForecastNasional(rows), [rows]);
  const agingRows = useMemo(() => buildAgingList(records), [records]);
  const planDetail = useMemo(() => buildSalesPlanDetail(salesPlans, records, periode), [salesPlans, records, periode]);
  const planDetailShown = planCabang ? planDetail.filter((g) => g.cabang === planCabang) : planDetail;

  async function deletePlanItem(planSe: string, index: number, uraian: string, nominal: number) {
    if (!window.confirm(`Hapus "${uraian || '(tanpa uraian)'}" (${formatRupiah(nominal)}) dari rencana ${planSe} periode ${periode}?`)) return;
    const key = `${planSe}|${index}`;
    setDeleting(key);
    try {
      const res = await api.del<{ salesPlan?: SalesPlan; deleted?: boolean; id?: string }>('/api/sales-plans', { se: planSe, periode, index, uraian });
      if (res.salesPlan) upsertSalesPlan(res.salesPlan);
      else if (res.id) removeSalesPlan(res.id);
      toast(res.deleted ? `Material dihapus — rencana ${planSe} kini kosong dan ikut dihapus` : 'Material dihapus dari rencana', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus material', 'error');
    } finally {
      setDeleting('');
    }
  }

  const year = periode.slice(0, 4);
  const annualOf = (cabang: string) => num(annualTargets.find((a) => a.cabang.toUpperCase() === cabang.toUpperCase() && a.year === year)?.amount);
  const monthRow = (cabang: string) => budgetTargets.find((b) => b.cabang.toUpperCase() === cabang.toUpperCase() && b.periode === periode);
  /** Jumlah target bulanan setahun (dengan carry-forward), untuk dibandingkan dengan target tahunan. */
  const monthlySum = (cabang: string) => {
    let s = 0;
    for (let m = 1; m <= 12; m++) s += yearMonthTarget(budgetTargets, cabang, year, m);
    return s;
  };
  const annualTotal = rows.reduce((s, r) => s + annualOf(r.cabang), 0);
  const cabangTargets = useMemo(() => rows.map((r) => ({ cabang: r.cabang, target: r.target })), [rows]);
  const seWon = useMemo(() => new Map(seRows.map((r) => [r.se, r.won])), [seRows]);
  // BM: pengingat wajib bila target cabangnya belum selesai dibagi ke Sales.
  const ownAlloc = useMemo(() => {
    if (currentUser?.role !== 'bm' || !currentUser.cabang) return null;
    const c = currentUser.cabang.toUpperCase();
    return buildAllocations(cabangTargets.filter((x) => x.cabang.toUpperCase() === c), seTargets, roster, periode)[0] || null;
  }, [currentUser, cabangTargets, seTargets, roster, periode]);

  async function saveAnnual(cabang: string, amount: number) {
    const manual = budgetTargets.filter((b) => b.cabang.toUpperCase() === cabang.toUpperCase() && b.periode.startsWith(`${year}-`) && !b.fromAnnual && num(b.amount) > 0);
    let overwrite = false;
    if (manual.length && amount > 0) {
      overwrite = window.confirm(
        `${cabang}: ${manual.length} bulan di ${year} sudah diisi manual (${manual.map((b) => labelPeriode(b.periode)).join(', ')}).\n\n` +
          `OK = ganti juga bulan-bulan itu dengan target tahunan ÷ 12.\nBatal = biarkan bulan manual, isi bulan lainnya saja.`,
      );
    }
    try {
      const res = await api.put<{ annualTarget: AnnualTarget; budgetTargets: BudgetTarget[] }>('/api/annual-targets', { cabang, year, amount, overwrite });
      upsertAnnualTarget(res.annualTarget);
      res.budgetTargets.forEach(upsertBudgetTarget);
      toast(`Target tahunan ${cabang} ${year} disimpan · ${res.budgetTargets.length} bulan diisi otomatis`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan target tahunan', 'error');
    }
  }

  async function saveTarget(cabang: string, amount: number) {
    try {
      const { budgetTarget } = await api.put<{ budgetTarget: BudgetTarget }>('/api/budget-targets', { cabang, periode, amount });
      upsertBudgetTarget(budgetTarget);
      toast(`Target ${cabang} disimpan`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan target', 'error');
    }
  }

  return (
    <Modal show={show} onClose={closeModal} title={tr("Forecast & Pipeline")} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr("Tutup")}</button>}>
      {/* Deliberate divergence from the single-file app, which has no period
          picker: it keys budget targets by cabang alone, while BudgetTarget
          here is unique on (cabang, periode). The picker is what makes
          per-month targets usable. Decided 2026-08-23 — keep it. */}
      <div className="toolbar-row">
        <label style={{ fontSize: 12, textTransform: 'none' }}>{tr("Periode")}</label>
        <input type="month" className="btn-sm" value={periode} onChange={(e) => setPeriode(e.target.value)} />
      </div>

      {ownAlloc && (ownAlloc.status === 'empty' || ownAlloc.status === 'short') && (
        <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 10 }}>
          <b>{tr("Wajib:")}</b> {tr("target cabang")} {ownAlloc.cabang} {labelPeriode(periode)} {formatRupiah(ownAlloc.target)} {ownAlloc.status === 'empty' ? tr("belum dibagi ke Sales") : `baru dibagi ${formatRupiah(ownAlloc.allocated)}${ownAlloc.missing.length ? `; ${ownAlloc.missing.length} Sales belum punya target` : ''}`}.{' '}
          {tr("Isi di bagian")} <b>{tr("Target per Sales")}</b> {tr("di bawah.")}
        </div>
      )}
      <div className="import-summary" style={{ marginTop: 0 }}>
        {tr("Forecast dihitung dari pipeline aktif (status Permintaan/Penawaran Harga/Negosiasi) dikalikan probabilitas tiap tahap: Permintaan 10%, Penawaran Harga 30%, Negosiasi 60%. Data mengikuti cakupan role Anda yang login. Target bulanan default =")} <b>{tr("target tahunan ÷ 12")}</b> {tr("(isi kolom Target Tahunan, bulan yang kosong terisi otomatis); angka bulanan yang diketik manual tetap dipakai dan tidak ikut berubah saat target tahunan diubah. Bulan tanpa target memakai target bulan sebelumnya (ditandai \"dari …\").")}
      </div>

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="label">{tr("Weighted Forecast")}</div>
          <div className="value">{formatRupiah(nasional.weighted)}</div>
          <div className="foot">{rows.reduce((n, r) => n + r.openCount, 0)} {tr("deal aktif")}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Target Bulan Ini")}</div>
          <div className="value">{formatRupiah(nasional.target)}</div>
          <div className="foot">{rows.length} {tr("cabang")}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Rencana Penjualan")}</div>
          <div className="value">{formatRupiah(nasional.rencana)}</div>
          <div className="foot">{nasional.rencanaVsTarget}{tr("% dari target")}</div>
        </div>
        <div className="kpi won">
          <div className="label">{tr("Realisasi (Won) Bulan Ini")}</div>
          <div className="value">{formatRupiah(nasional.won)}</div>
          <div className="foot">{rows.reduce((n, r) => n + (r.won > 0 ? 1 : 0), 0)} {tr("cabang closed")}</div>
        </div>
        <div className="kpi rate">
          <div className="label">{tr("Achievement vs Target")}</div>
          <div className="value">{nasional.achievement}%</div>
          <div className="foot">{tr("realisasi / target")}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Realisasi vs Rencana")}</div>
          <div className="value">{nasional.wonVsRencana}%</div>
          <div className="foot">{tr("yang direncanakan Sales, berapa jadi")}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Gap ke Target")}</div>
          <div className="value">{formatRupiah(Math.max(0, nasional.target - nasional.won))}</div>
          <div className="foot">{nasional.won >= nasional.target ? tr("Target tercapai") : tr("sisa menuju target")}</div>
        </div>
        <div className="kpi lost">
          <div className="label">{tr("Pipeline Macet")}</div>
          <div className="value">{agingRows.length}</div>
          <div className="foot">{tr(">")} {AGING_THRESHOLD_DAYS} {tr("hari tanpa progres")}</div>
        </div>
      </div>

      <div className="import-summary" style={{ marginTop: 12 }}>
        <b>{tr("Rencana Penjualan")}</b> {tr("adalah total yang Sales sendiri niatkan dijual bulan ini (diisi lewat tombol \"Rencana Penjualan\", per SE, dirinci per material) — berbeda dari")} <b>{tr("Target")}</b> {tr("yang ditetapkan perusahaan. \"Realisasi vs Rencana\" rendah berarti banyak yang direncanakan tidak jadi terjual; \"Rencana vs Target\" rendah berarti rencananya sendiri belum cukup untuk mengejar target, terlepas dari eksekusinya.")}
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Target vs Rencana vs Realisasi — per Cabang")}</h4>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>{tr("Belum ada data periode ini")}</h3><p>{tr("Pilih periode lain atau tetapkan target cabang.")}</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>{tr("Cabang")}</th><th>{tr("Target Tahunan")} {year}</th><th>{tr("Target")} {labelPeriode(periode)}</th><th>{tr("Rencana")}</th><th>{tr("Realisasi (Won)")}</th><th>{tr("Weighted")}</th><th>{tr("Ach. Target")}</th><th>{tr("Realisasi/Rencana")}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cabang}>
                  <td style={{ fontWeight: 600 }}>{r.cabang}</td>
                  <td>
                    {(() => {
                      const annual = annualOf(r.cabang);
                      const sum = monthlySum(r.cabang);
                      const note = annual > 0 && Math.abs(sum - annual) > annual * 0.005 ? `Σ 12 bulan ${formatRupiah(sum)}` : annual > 0 ? `${formatRupiah(Math.round(annual / 12))}/bulan` : undefined;
                      return canEdit(r.cabang) ? (
                        <TargetInput key={`${r.cabang}-${year}-annual`} value={annual} from={null} note={note} onSave={(v) => saveAnnual(r.cabang, v)} />
                      ) : (
                        <span className="mono">
                          {annual > 0 ? formatRupiah(annual) : '-'}
                          {note && <span className="field-note" style={{ display: 'block' }}>{note}</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    {canEdit(r.cabang) ? (
                      <TargetInput key={`${r.cabang}-${periode}`} value={r.target} from={r.targetFrom} note={monthRow(r.cabang)?.fromAnnual ? 'tahunan ÷ 12' : r.target > 0 ? 'diisi manual' : undefined} onSave={(v) => saveTarget(r.cabang, v)} />
                    ) : (
                      <span className="mono">
                        {formatRupiah(r.target)}
                        {r.targetFrom && <span className="field-note" style={{ display: 'block' }}>{tr("dari")} {labelPeriode(r.targetFrom)}</span>}
                      </span>
                    )}
                  </td>
                  <td className="mono">{formatRupiah(r.rencana)}</td>
                  <td className="mono">{formatRupiah(r.won)}</td>
                  <td className="mono">{formatRupiah(r.weighted)}</td>
                  <td className="center">
                    {r.target > 0 ? (
                      <span className={`badge ${r.achievement >= 100 ? 'green' : r.achievement >= 60 ? 'amber' : 'rust'}`}>{r.achievement}%</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="center">
                    {r.rencana > 0 ? (
                      <span className={`badge ${r.wonVsRencana >= 100 ? 'green' : r.wonVsRencana >= 60 ? 'amber' : 'rust'}`}>{r.wonVsRencana}%</span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--steel-100)' }}>
                <td>NASIONAL</td>
                <td className="mono">{formatRupiah(annualTotal)}</td>
                <td className="mono">{formatRupiah(nasional.target)}</td>
                <td className="mono">{formatRupiah(nasional.rencana)}</td>
                <td className="mono">{formatRupiah(nasional.won)}</td>
                <td className="mono">{formatRupiah(nasional.weighted)}</td>
                <td className="center">{nasional.target > 0 ? `${nasional.achievement}%` : '-'}</td>
                <td className="center">{nasional.rencana > 0 ? `${nasional.wonVsRencana}%` : '-'}</td>
              </tr>
            </tfoot>

          </table>
        </div>
      )}

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Target per Sales — pembagian target cabang")}</h4>
      <div className="field-note" style={{ marginTop: 0, marginBottom: 8 }}>
        {tr("Alur: pusat menetapkan target cabang (tahunan/bulanan) → BM")} <b>{tr("wajib")}</b> {tr("membagi target cabang ke tiap Sales → Sales menerima notifikasi target → RM/GM memantau status pembagian.")}
      </div>
      <SeTargetSection periode={periode} cabangTargets={cabangTargets} seWon={seWon} canEdit={canEdit} currentUser={currentUser} roster={roster} />

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Rollup per Regional")}</h4>
      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table">
          <thead>
            <tr><th>{tr("Regional")}</th><th>{tr("Cabang")}</th><th>{tr("Target")}</th><th>{tr("Rencana")}</th><th>{tr("Realisasi (Won)")}</th><th>{tr("Ach. Target")}</th><th>{tr("Realisasi/Rencana")}</th></tr>
          </thead>
          <tbody>
            {regRows.map((g) => (
              <tr key={g.reg ?? 'unknown'}>
                <td style={{ fontWeight: 600 }}>{g.reg != null ? `Regional ${g.reg}` : tr("Belum diketahui")}</td>
                <td className="center">{g.totals.cabangCount}</td>
                <td className="mono">{formatRupiah(g.totals.target)}</td>
                <td className="mono">{formatRupiah(g.totals.rencana)}</td>
                <td className="mono">{formatRupiah(g.totals.won)}</td>
                <td className="center">{g.totals.target > 0 ? <span className={`badge ${g.totals.achievement >= 100 ? 'green' : g.totals.achievement >= 60 ? 'amber' : 'rust'}`}>{g.totals.achievement}%</span> : '-'}</td>
                <td className="center">{g.totals.rencana > 0 ? <span className={`badge ${g.totals.wonVsRencana >= 100 ? 'green' : g.totals.wonVsRencana >= 60 ? 'amber' : 'rust'}`}>{g.totals.wonVsRencana}%</span> : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, background: 'var(--steel-100)' }}>
              <td>NASIONAL</td>
              <td className="center">{rows.length}</td>
              <td className="mono">{formatRupiah(nasional.target)}</td>
              <td className="mono">{formatRupiah(nasional.rencana)}</td>
              <td className="mono">{formatRupiah(nasional.won)}</td>
              <td className="center">{nasional.target > 0 ? `${nasional.achievement}%` : '-'}</td>
              <td className="center">{nasional.rencana > 0 ? `${nasional.wonVsRencana}%` : '-'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="field-note" style={{ marginTop: 6 }}>
        {tr("Cabang tanpa regional yang diketahui (belum pernah muncul di data prospek manapun dengan regional terisi) dikelompokkan di baris \"Belum diketahui\", bukan dibuang dari perhitungan.")}
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Rencana Penjualan per Sales Engineer")}</h4>
      {seList.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>{tr("Belum ada aktivitas atau rencana SE pada periode ini.")}</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>{tr("Sales Engineer (SE)")}</th><th>{tr("Cabang")}</th><th>{tr("Target")}</th><th>{tr("Aktif Pipeline")}</th><th>{tr("Weighted")}</th><th>{tr("Rencana")}</th><th>{tr("Realisasi (Won)")}</th><th>{tr("Ach. Target")}</th><th>{tr("Realisasi/Rencana")}</th><th></th></tr>
            </thead>
            <tbody>
              {seList.map((r) => {
                const rencana = seRencana.get(r.se) || 0;
                const rasio = rencana > 0 ? Math.round((r.won / rencana) * 100) : null;
                const bolehEdit = permRencanaE && canEditSalesPlanFor(currentUser, r.se, r.cabang);
                const seT = seTargetOf(seTargets, r.se, periode);
                return (
                  <tr key={r.se}>
                    <td style={{ fontWeight: 600 }}>{r.se}</td>
                    <td>{r.cabang}</td>
                    <td className="mono">{seT > 0 ? formatRupiah(seT) : <span className="badge rust">{tr("Belum ada")}</span>}</td>
                    <td className="center">{r.openCount}</td>
                    <td className="mono">{formatRupiah(r.weighted)}</td>
                    <td className="mono">{rencana > 0 ? formatRupiah(rencana) : <span className="badge slate">{tr("Belum diisi")}</span>}</td>
                    <td className="mono">{formatRupiah(r.won)}</td>
                    <td className="center">{seT > 0 ? <span className={`badge ${r.won >= seT ? 'green' : r.won >= seT * 0.6 ? 'amber' : 'rust'}`}>{Math.round((r.won / seT) * 100)}%</span> : '-'}</td>
                    <td className="center">{rasio == null ? '-' : <span className={`badge ${rasio >= 100 ? 'green' : rasio >= 60 ? 'amber' : 'rust'}`}>{rasio}%</span>}</td>
                    <td>
                      {bolehEdit && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            useUiStore.setState({ salesPlanCtx: { se: r.se, cabang: r.cabang === '-' ? '' : r.cabang, periode } });
                            openModal('salesPlan');
                          }}
                        >
                          {rencana > 0 ? tr("Ubah Rencana") : tr("Isi Rencana")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Rincian Rencana Penjualan — per Cabang & Sales")}</h4>
      {planDetail.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>{tr("Belum ada rencana penjualan pada periode ini.")}</div>
      ) : (
        <>
          {planDetail.length > 1 && (
            <div className="toolbar-row">
              <label style={{ fontSize: 12, textTransform: 'none' }}>{tr("Cabang")}</label>
              <select className="btn-sm" value={planCabang} onChange={(e) => setPlanCabang(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">{tr("Semua cabang (")}{planDetail.length})</option>
                {planDetail.map((g) => (
                  <option key={g.cabang} value={g.cabang}>
                    {g.cabang} — {formatRupiah(g.total)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th>SE</th>
                  <th>{tr("Customer")}</th>
                  <th>{tr("Line")}</th>
                  <th>{tr("Uraian Material")}</th>
                  <th style={{ textAlign: 'right' }}>{tr("Qty")}</th>
                  <th style={{ textAlign: 'right' }}>{tr("Harga")}</th>
                  <th style={{ textAlign: 'right' }}>{tr("Nominal")}</th>
                  <th>{tr("Status Pipeline")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {planDetailShown.map((g) => (
                  <Fragment key={g.cabang}>
                    <tr style={{ background: 'var(--steel-100)', fontWeight: 700 }}>
                      <td colSpan={6}>{tr("Cabang")} {g.cabang} · {g.ses.length} SE</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatRupiah(g.total)}</td>
                      <td colSpan={2}></td>
                    </tr>
                    {g.ses.map((x) => {
                      const bolehHapus = permRencanaD && canEditSalesPlanFor(currentUser, x.se, x.cabang);
                      return (
                        <Fragment key={x.planId}>
                          {x.items.map((it, i) => (
                            <tr key={`${x.planId}-${it.index}`}>
                              <td style={{ fontWeight: 600 }}>{i === 0 ? x.se : ''}</td>
                              <td>{it.status.customer || <span style={{ color: 'var(--text-soft)' }}>-</span>}</td>
                              <td>{it.line || '-'}</td>
                              <td>{it.uraian || '-'}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>{num(it.qty).toLocaleString('id-ID')}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>{formatRupiah(num(it.harga))}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>{formatRupiah(it.nominal)}</td>
                              <td><span className={`badge ${it.status.color}`}>{it.status.label}</span></td>
                              <td>
                                {bolehHapus && (
                                  <button
                                    type="button"
                                    className="icon-btn danger"
                                    title={tr("Hapus material dari rencana")}
                                    disabled={deleting === `${x.se}|${it.index}`}
                                    onClick={() => deletePlanItem(x.se, it.index, it.uraian, it.nominal)}
                                  >
                                    <IconTrash />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 600 }}>
                            <td colSpan={6} style={{ textAlign: 'right', color: 'var(--text-soft)' }}>{tr("Subtotal")} {x.se} ({x.items.length} {tr("material)")}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{formatRupiah(x.total)}</td>
                            <td colSpan={2}></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: 'var(--steel-100)' }}>
                  <td colSpan={6}>TOTAL {planCabang ? `CABANG ${planCabang}` : 'RENCANA'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatRupiah(planDetailShown.reduce((t, g) => t + g.total, 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="field-note" style={{ marginTop: 6 }}>
            {tr("Status pipeline diambil dari prospek asal material (baris yang ditarik lewat \"Ambil dari Prospek\"); baris yang diketik manual ditandai \"Manual\". Tombol hapus muncul untuk pemilik rencana, BM cabangnya, GM dan Admin. Rencana yang semua materialnya dihapus ikut terhapus.")}
          </div>
        </>
      )}

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>{tr("Aging Alert — Pipeline Macet")}</h4>
      {agingRows.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>
          {tr("Tidak ada pipeline macet. Semua deal aktif masih bergerak dalam")} {AGING_THRESHOLD_DAYS} {tr("hari terakhir.")}
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>{tr("Customer")}</th><th>{tr("Cabang")}</th><th>SE</th><th>{tr("Status")}</th><th>{tr("Nilai")}</th><th>{tr("Hari Macet")}</th></tr>
            </thead>
            <tbody>
              {agingRows.map(({ record: r, days }) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.customer}</td>
                    <td>{r.cabang || '-'}</td>
                    <td>{r.se || '-'}</td>
                    <td><span className={`badge ${meta?.color || 'slate'}`}>{meta?.label || '-'}</span></td>
                    <td className="mono">{formatRupiah(r.value)}</td>
                    <td className="center"><span className="badge rust">{days} {tr("hari")}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
