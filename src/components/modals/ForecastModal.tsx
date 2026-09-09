'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import { AGING_THRESHOLD_DAYS, CABANG_LIST, STATUS_META } from '@/lib/constants';
import { buildAgingList, buildForecast, buildForecastByReg, buildForecastBySe, buildForecastNasional } from '@/lib/reports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { BudgetTarget } from '@/lib/types';

function currentPeriode(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ForecastModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'forecast';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const records = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const upsertBudgetTarget = useDataStore((s) => s.upsertBudgetTarget);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [periode, setPeriode] = useState(currentPeriode());

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

  const canEdit = (cabang: string) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin' || currentUser.role === 'gm') return true;
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
    <Modal show={show} onClose={closeModal} title="Forecast & Pipeline" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      {/* Deliberate divergence from the single-file app, which has no period
          picker: it keys budget targets by cabang alone, while BudgetTarget
          here is unique on (cabang, periode). The picker is what makes
          per-month targets usable. Decided 2026-08-23 — keep it. */}
      <div className="toolbar-row">
        <label style={{ fontSize: 12, textTransform: 'none' }}>Periode</label>
        <input type="month" className="btn-sm" value={periode} onChange={(e) => setPeriode(e.target.value)} />
      </div>

      <div className="import-summary" style={{ marginTop: 0 }}>
        Forecast dihitung dari pipeline aktif (status Permintaan/Penawaran Harga/Negosiasi) dikalikan probabilitas tiap
        tahap: Permintaan 10%, Penawaran Harga 30%, Negosiasi 60%. Data mengikuti cakupan role Anda yang login.
      </div>

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="label">Weighted Forecast</div>
          <div className="value">{formatRupiah(nasional.weighted)}</div>
          <div className="foot">{rows.reduce((n, r) => n + r.openCount, 0)} deal aktif</div>
        </div>
        <div className="kpi">
          <div className="label">Target Bulan Ini</div>
          <div className="value">{formatRupiah(nasional.target)}</div>
          <div className="foot">{rows.length} cabang</div>
        </div>
        <div className="kpi">
          <div className="label">Rencana Penjualan</div>
          <div className="value">{formatRupiah(nasional.rencana)}</div>
          <div className="foot">{nasional.rencanaVsTarget}% dari target</div>
        </div>
        <div className="kpi won">
          <div className="label">Realisasi (Won) Bulan Ini</div>
          <div className="value">{formatRupiah(nasional.won)}</div>
          <div className="foot">{rows.reduce((n, r) => n + (r.won > 0 ? 1 : 0), 0)} cabang closed</div>
        </div>
        <div className="kpi rate">
          <div className="label">Achievement vs Target</div>
          <div className="value">{nasional.achievement}%</div>
          <div className="foot">realisasi / target</div>
        </div>
        <div className="kpi">
          <div className="label">Realisasi vs Rencana</div>
          <div className="value">{nasional.wonVsRencana}%</div>
          <div className="foot">yang direncanakan Sales, berapa jadi</div>
        </div>
        <div className="kpi">
          <div className="label">Gap ke Target</div>
          <div className="value">{formatRupiah(Math.max(0, nasional.target - nasional.won))}</div>
          <div className="foot">{nasional.won >= nasional.target ? 'Target tercapai' : 'sisa menuju target'}</div>
        </div>
        <div className="kpi lost">
          <div className="label">Pipeline Macet</div>
          <div className="value">{agingRows.length}</div>
          <div className="foot">&gt; {AGING_THRESHOLD_DAYS} hari tanpa progres</div>
        </div>
      </div>

      <div className="import-summary" style={{ marginTop: 12 }}>
        <b>Rencana Penjualan</b> adalah total yang Sales sendiri niatkan dijual bulan ini (diisi lewat tombol &quot;Rencana
        Penjualan&quot;, per SE, dirinci per material) — berbeda dari <b>Target</b> yang ditetapkan perusahaan. &quot;Realisasi vs
        Rencana&quot; rendah berarti banyak yang direncanakan tidak jadi terjual; &quot;Rencana vs Target&quot; rendah berarti
        rencananya sendiri belum cukup untuk mengejar target, terlepas dari eksekusinya.
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Target vs Rencana vs Realisasi — per Cabang</h4>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data periode ini</h3><p>Pilih periode lain atau tetapkan target cabang.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Cabang</th><th>Target</th><th>Rencana</th><th>Realisasi (Won)</th><th>Weighted</th><th>Ach. Target</th><th>Realisasi/Rencana</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cabang}>
                  <td style={{ fontWeight: 600 }}>{r.cabang}</td>
                  <td>
                    {canEdit(r.cabang) ? (
                      <input
                        type="number"
                        defaultValue={r.target || ''}
                        onBlur={(e) => {
                          const v = num(e.target.value);
                          if (v !== r.target) saveTarget(r.cabang, v);
                        }}
                        style={{ maxWidth: 150 }}
                      />
                    ) : (
                      <span className="mono">{formatRupiah(r.target)}</span>
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

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Rollup per Regional</h4>
      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table">
          <thead>
            <tr><th>Regional</th><th>Cabang</th><th>Target</th><th>Rencana</th><th>Realisasi (Won)</th><th>Ach. Target</th><th>Realisasi/Rencana</th></tr>
          </thead>
          <tbody>
            {regRows.map((g) => (
              <tr key={g.reg ?? 'unknown'}>
                <td style={{ fontWeight: 600 }}>{g.reg != null ? `Regional ${g.reg}` : 'Belum diketahui'}</td>
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
        Cabang tanpa regional yang diketahui (belum pernah muncul di data prospek manapun dengan regional terisi) dikelompokkan di baris &quot;Belum diketahui&quot;, bukan dibuang dari perhitungan.
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Rencana Penjualan per Sales Engineer</h4>
      {seList.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>Belum ada aktivitas atau rencana SE pada periode ini.</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Sales Engineer (SE)</th><th>Cabang</th><th>Aktif Pipeline</th><th>Weighted</th><th>Rencana</th><th>Realisasi (Won)</th><th>Realisasi/Rencana</th><th></th></tr>
            </thead>
            <tbody>
              {seList.map((r) => {
                const rencana = seRencana.get(r.se) || 0;
                const rasio = rencana > 0 ? Math.round((r.won / rencana) * 100) : null;
                const bolehEdit = !currentUser ? false : ['admin', 'gm'].includes(currentUser.role) || (currentUser.role === 'sales' && (currentUser.se || '').toUpperCase() === r.se) || (currentUser.role === 'bm' && (currentUser.cabang || '').toUpperCase() === r.cabang.toUpperCase());
                return (
                  <tr key={r.se}>
                    <td style={{ fontWeight: 600 }}>{r.se}</td>
                    <td>{r.cabang}</td>
                    <td className="center">{r.openCount}</td>
                    <td className="mono">{formatRupiah(r.weighted)}</td>
                    <td className="mono">{rencana > 0 ? formatRupiah(rencana) : <span className="badge slate">Belum diisi</span>}</td>
                    <td className="mono">{formatRupiah(r.won)}</td>
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
                          {rencana > 0 ? 'Ubah Rencana' : 'Isi Rencana'}
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

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Aging Alert — Pipeline Macet</h4>
      {agingRows.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>
          Tidak ada pipeline macet. Semua deal aktif masih bergerak dalam {AGING_THRESHOLD_DAYS} hari terakhir.
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Customer</th><th>Cabang</th><th>SE</th><th>Status</th><th>Nilai</th><th>Hari Macet</th></tr>
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
                    <td className="center"><span className="badge rust">{days} hari</span></td>
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
