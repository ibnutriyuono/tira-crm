'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import { AGING_THRESHOLD_DAYS, CABANG_LIST, STATUS_META } from '@/lib/constants';
import { buildAgingList, buildForecast, buildForecastBySe } from '@/lib/reports';
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

  const records = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
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

  const rows = useMemo(() => buildForecast(records, budgetTargets, periode, CABANG_LIST), [records, budgetTargets, periode]);
  const seRows = useMemo(() => buildForecastBySe(records, periode), [records, periode]);
  const agingRows = useMemo(() => buildAgingList(records), [records]);

  const totals = rows.reduce(
    (acc, r) => ({ target: acc.target + r.target, won: acc.won + r.won, weighted: acc.weighted + r.weighted, aging: acc.aging + r.agingCount }),
    { target: 0, won: 0, weighted: 0, aging: 0 },
  );

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
          <div className="value">{formatRupiah(totals.weighted)}</div>
          <div className="foot">{rows.reduce((n, r) => n + r.openCount, 0)} deal aktif</div>
        </div>
        <div className="kpi won">
          <div className="label">Won Bulan Ini</div>
          <div className="value">{formatRupiah(totals.won)}</div>
          <div className="foot">{rows.reduce((n, r) => n + (r.won > 0 ? 1 : 0), 0)} deal closed</div>
        </div>
        <div className="kpi">
          <div className="label">Target Bulan Ini</div>
          <div className="value">{formatRupiah(totals.target)}</div>
          <div className="foot">{rows.length} cabang</div>
        </div>
        <div className="kpi rate">
          <div className="label">Achievement</div>
          <div className="value">{totals.target > 0 ? ((totals.won / totals.target) * 100).toFixed(1) : '0.0'}%</div>
          <div className="foot">dari target bulan ini</div>
        </div>
        <div className="kpi">
          <div className="label">Gap ke Target</div>
          <div className="value">{formatRupiah(Math.max(0, totals.target - totals.won))}</div>
          <div className="foot">{totals.won >= totals.target ? 'Target tercapai' : 'sisa menuju target'}</div>
        </div>
        <div className="kpi lost">
          <div className="label">Pipeline Macet</div>
          <div className="value">{agingRows.length}</div>
          <div className="foot">&gt; {AGING_THRESHOLD_DAYS} hari tanpa progres</div>
        </div>
      </div>

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Target vs Pencapaian</h4>
      <div className="import-summary" style={{ display: 'none' }}>
        Target <b>{formatRupiah(totals.target)}</b> · Won <b>{formatRupiah(totals.won)}</b> · Pipeline berbobot{' '}
        <b>{formatRupiah(totals.weighted)}</b> · <b>{totals.aging}</b> prospek mandek &gt; 14 hari.
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data periode ini</h3><p>Pilih periode lain atau tetapkan target cabang.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Cabang</th><th>Target Bulan Ini</th><th>Weighted Forecast</th><th>Won Bulan Ini</th><th>Achievement</th></tr>
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
                  <td className="mono">{formatRupiah(r.weighted)}</td>
                  <td className="mono">{formatRupiah(r.won)}</td>
                  <td className="center">
                    {r.target > 0 ? (
                      <span className={`badge ${r.achievement >= 100 ? 'green' : r.achievement >= 60 ? 'amber' : 'rust'}`}>{r.achievement}%</span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--steel-100)' }}>
                <td>TOTAL</td>
                <td className="mono">{formatRupiah(totals.target)}</td>
                <td className="mono">{formatRupiah(totals.weighted)}</td>
                <td className="mono">{formatRupiah(totals.won)}</td>
                <td className="center">
                  {totals.target > 0 ? `${((totals.won / totals.target) * 100).toFixed(0)}%` : '-'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <h4 style={{ marginTop: 18, marginBottom: 6 }}>Per Sales Engineer</h4>
      {seRows.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 0 }}>Belum ada aktivitas SE pada periode ini.</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Sales Engineer (SE)</th><th>Cabang</th><th>Aktif Pipeline</th><th>Weighted Forecast</th><th>Won Bulan Ini</th><th>Deal Won</th></tr>
            </thead>
            <tbody>
              {seRows.map((r) => (
                <tr key={r.se}>
                  <td style={{ fontWeight: 600 }}>{r.se}</td>
                  <td>{r.cabang}</td>
                  <td className="center">{r.openCount}</td>
                  <td className="mono">{formatRupiah(r.weighted)}</td>
                  <td className="mono">{formatRupiah(r.won)}</td>
                  <td className="center">{r.wonCount}</td>
                </tr>
              ))}
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
