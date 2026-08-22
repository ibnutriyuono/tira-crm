'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatRupiah, num } from '@/lib/format';
import { buildForecast } from '@/lib/reports';
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
    return false;
  };

  const rows = useMemo(() => buildForecast(records, budgetTargets, periode), [records, budgetTargets, periode]);

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
    <Modal show={show} onClose={closeModal} title="Forecast & Target" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        <label style={{ fontSize: 12, textTransform: 'none' }}>Periode</label>
        <input type="month" className="btn-sm" value={periode} onChange={(e) => setPeriode(e.target.value)} />
      </div>

      <div className="import-summary">
        Target <b>{formatRupiah(totals.target)}</b> · Won <b>{formatRupiah(totals.won)}</b> · Pipeline berbobot{' '}
        <b>{formatRupiah(totals.weighted)}</b> · <b>{totals.aging}</b> prospek mandek &gt; 14 hari.
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data periode ini</h3><p>Pilih periode lain atau tetapkan target cabang.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Cabang</th><th>Target</th><th>Won</th><th>Achievement</th><th>Pipeline Berbobot</th><th>Open</th><th>Mandek</th></tr>
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
                  <td className="mono">{formatRupiah(r.won)}</td>
                  <td className="center">
                    <span className={`badge ${r.achievement >= 100 ? 'green' : r.achievement >= 60 ? 'amber' : 'rust'}`}>{r.achievement}%</span>
                  </td>
                  <td className="mono">{formatRupiah(r.weighted)}</td>
                  <td className="center">{r.openCount}</td>
                  <td className="center">{r.agingCount > 0 ? <span className="badge rust">{r.agingCount}</span> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
