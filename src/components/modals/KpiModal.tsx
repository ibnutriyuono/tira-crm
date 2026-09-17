'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CABANG_LIST } from '@/lib/constants';
import { formatRupiah } from '@/lib/format';
import { buildKpiScorecard, MONTH_LABELS } from '@/lib/kpi';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { BudgetTarget } from '@/lib/types';

function thisYear(): string {
  return String(new Date().getFullYear());
}

const SIGNAL_BADGE: Record<string, string> = { blue: 'steel', green: 'green', yellow: 'amber', red: 'rust' };
const SIGNAL_LABEL: Record<string, string> = { blue: '>100%', green: '=100%', yellow: '90-99%', red: '<90%' };

function fmtAchieve(v: number | null): string {
  return v == null ? '-' : `${Math.round(v * 100)}%`;
}
function fmtScore(v: number | null): string {
  return v == null ? '-' : v.toFixed(1);
}
function fmtCell(v: number | null, unit: string): string {
  if (v == null) return '-';
  return unit === '%' ? `${(v * 100).toFixed(1)}%` : formatRupiah(v);
}

/**
 * Mirrors the uploaded Dept_KPI_sales.xlsx scorecard structure — same 4
 * weighted items (Sales Order 30 / Invoice 35 / Prospect-Opportunity 10 /
 * Gross Margin 25), same cumulative year-to-date Budget/Result/Achieve/
 * Score/Signal mechanic, same signal color thresholds. Three of the four
 * items are computed live from CRM data (see lib/kpi.ts for exactly how and
 * why); Gross Margin stays a manual monthly entry pending the Sage 300
 * integration, per explicit instruction.
 */
export function KpiModal() {
  const show = useUiStore((s) => s.modal === 'kpi');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const upsertBudgetTarget = useDataStore((s) => s.upsertBudgetTarget);
  const toast = useDataStore((s) => s.toast);

  const [year, setYear] = useState(thisYear());
  const [scopeKey, setScopeKey] = useState('nasional'); // gm/admin's picker only

  // Cabang -> region is only knowable from prospect rows (no first-class
  // Cabang entity in this app) — identical technique to ForecastModal's own
  // cabangReg map, kept local here rather than shared since it's a handful
  // of lines and the two screens have no other reason to depend on each other.
  const cabangReg = useMemo(() => {
    const m: Record<string, number | null> = {};
    prospects.forEach((r) => {
      const cb = (r.cabang || '').toUpperCase();
      if (cb && m[cb] == null) m[cb] = r.reg;
    });
    return m;
  }, [prospects]);

  const regionList = useMemo(() => {
    const regs = new Set<number>();
    Object.values(cabangReg).forEach((r) => {
      if (r != null) regs.add(r);
    });
    return Array.from(regs).sort((a, b) => a - b);
  }, [cabangReg]);

  const { cabangList, scopeLabel, scopeIsPicker } = useMemo(() => {
    if (!currentUser) return { cabangList: [] as string[], scopeLabel: '-', scopeIsPicker: false };
    if (currentUser.role === 'sales' || currentUser.role === 'bm') {
      const c = (currentUser.cabang || '').toUpperCase();
      return { cabangList: c ? [c] : [], scopeLabel: c || '(cabang belum diset)', scopeIsPicker: false };
    }
    if (currentUser.role === 'rm') {
      const reg = currentUser.reg ?? -1;
      const list = CABANG_LIST.filter((c) => cabangReg[c] === reg);
      return { cabangList: list, scopeLabel: `Regional ${reg} (Rollup ${list.length} cabang)`, scopeIsPicker: false };
    }
    // gm / admin: free picker
    if (scopeKey === 'nasional') return { cabangList: CABANG_LIST, scopeLabel: 'Nasional (Rollup semua cabang)', scopeIsPicker: true };
    if (scopeKey.startsWith('reg-')) {
      const reg = Number(scopeKey.slice(4));
      const list = CABANG_LIST.filter((c) => cabangReg[c] === reg);
      return { cabangList: list, scopeLabel: `Regional ${reg} (Rollup ${list.length} cabang)`, scopeIsPicker: true };
    }
    return { cabangList: [scopeKey], scopeLabel: scopeKey, scopeIsPicker: true };
  }, [currentUser, scopeKey, cabangReg]);

  const scorecard = useMemo(() => buildKpiScorecard(prospects, budgetTargets, cabangList, year), [prospects, budgetTargets, cabangList, year]);

  // Which month's summary cards to lead with — the current calendar month
  // when viewing this year, otherwise the last/first month of a past/future
  // year, so the cards never show a blank month by default.
  const snapshotIdx = useMemo(() => {
    const now = new Date();
    if (String(now.getFullYear()) === year) return now.getMonth();
    return Number(year) < now.getFullYear() ? 11 : 0;
  }, [year]);

  // Gross Margin entry only makes sense against one concrete branch (its
  // Budget/Result live on that branch's own BudgetTarget row) — hidden
  // entirely for a rollup view, and further gated by the same permission
  // ForecastModal's inline Target field already uses for that branch.
  const canEditGm =
    cabangList.length === 1 &&
    !!currentUser &&
    (currentUser.role === 'admin' ||
      currentUser.role === 'gm' ||
      (currentUser.role === 'bm' && (currentUser.cabang || '').toUpperCase() === cabangList[0]) ||
      (currentUser.role === 'rm' && cabangReg[cabangList[0]] === currentUser.reg));

  const [gmMonth, setGmMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [gmTargetPct, setGmTargetPct] = useState('');
  const [gmResultPct, setGmResultPct] = useState('');
  const [savingGm, setSavingGm] = useState(false);

  // Prefill from whatever's already stored for the selected branch+month —
  // stored as a 0..1 decimal, shown/edited here as a plain percent number.
  useEffect(() => {
    if (cabangList.length !== 1) return;
    const bt = budgetTargets.find((b) => b.cabang.toUpperCase() === cabangList[0] && b.periode === `${year}-${gmMonth}`);
    setGmTargetPct(bt?.grossMarginTarget != null ? String(Math.round(bt.grossMarginTarget * 1000) / 10) : '');
    setGmResultPct(bt?.grossMarginResult != null ? String(Math.round(bt.grossMarginResult * 1000) / 10) : '');
  }, [cabangList, budgetTargets, year, gmMonth]);

  async function onSaveGm() {
    if (cabangList.length !== 1) return;
    setSavingGm(true);
    try {
      const { budgetTarget } = await api.put<{ budgetTarget: BudgetTarget }>('/api/budget-targets', {
        cabang: cabangList[0],
        periode: `${year}-${gmMonth}`,
        grossMarginTarget: gmTargetPct.trim() === '' ? null : Number(gmTargetPct) / 100,
        grossMarginResult: gmResultPct.trim() === '' ? null : Number(gmResultPct) / 100,
      });
      upsertBudgetTarget(budgetTarget);
      toast(`Gross Margin ${cabangList[0]} periode ${year}-${gmMonth} disimpan`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan Gross Margin', 'error');
    } finally {
      setSavingGm(false);
    }
  }

  function renderItemBlock(item: (typeof scorecard.items)[number]) {
    return (
      <div key={item.key} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{item.label}</span>
          <span className="badge slate">Bobot {item.bobot}</span>
          {!item.auto && <span className="badge amber">Manual — menunggu integrasi Sage 300</span>}
        </div>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table kpi-scorecard-table">
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}></th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="center">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>Budget</td>
                {item.months.map((c) => (
                  <td key={c.month} className="center mono" style={{ fontSize: 11 }}>
                    {fmtCell(c.budget, item.unit)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>Result</td>
                {item.months.map((c) => (
                  <td key={c.month} className="center mono" style={{ fontSize: 11 }}>
                    {fmtCell(c.result, item.unit)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>Achieve</td>
                {item.months.map((c) => (
                  <td key={c.month} className="center mono" style={{ fontSize: 11 }}>
                    {fmtAchieve(c.achieve)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>Score</td>
                {item.months.map((c) => (
                  <td key={c.month} className="center mono" style={{ fontSize: 11 }}>
                    {fmtScore(c.score)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>Signal</td>
                {item.months.map((c) => (
                  <td key={c.month} className="center">
                    {c.signal && (
                      <span className={`badge ${SIGNAL_BADGE[c.signal]}`} title={SIGNAL_LABEL[c.signal]}>
                        &nbsp;
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="KPI Scorecard"
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      <div className="import-summary" style={{ marginBottom: 14 }}>
        Sales Order, Invoice, dan Prospect/Opportunity dihitung otomatis dari data CRM, berjalan kumulatif dari Januari
        (year-to-date) — sama seperti pola budget pada template KPI resmi. Gross Margin masih diisi manual sampai
        terhubung dengan Sage 300.
      </div>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div>
          <label>Tahun</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ maxWidth: 110 }} />
        </div>
        {scopeIsPicker ? (
          <div>
            <label>Lingkup</label>
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
              <option value="nasional">Nasional (semua cabang)</option>
              {regionList.map((r) => (
                <option key={r} value={`reg-${r}`}>
                  Regional {r} (rollup)
                </option>
              ))}
              {CABANG_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label>Lingkup</label>
            <input type="text" value={scopeLabel} readOnly />
          </div>
        )}
      </div>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div className="kpi">
          <div className="label">Total Score ({MONTH_LABELS[snapshotIdx]})</div>
          <div className="value">{fmtScore(scorecard.totalScore[snapshotIdx])}</div>
          <div className="foot">dari 100</div>
        </div>
        {scorecard.items.map((it) => (
          <div className="kpi" key={it.key}>
            <div className="label">{it.label.split('(')[0].trim()}</div>
            <div className="value">{fmtAchieve(it.months[snapshotIdx].achieve)}</div>
            <div className="foot">
              Bobot {it.bobot} · Score {fmtScore(it.months[snapshotIdx].score)}
            </div>
          </div>
        ))}
      </div>

      {cabangList.length === 0 ? (
        <div className="empty-state">
          <h3>Cabang belum diset di akun ini</h3>
          <p>Hubungi Admin untuk melengkapi data cabang pada akun Anda.</p>
        </div>
      ) : (
        <>
          {scorecard.items.map(renderItemBlock)}

          <div style={{ fontWeight: 700, fontSize: 13, margin: '18px 0 4px' }}>TOTAL SCORE</div>
          <div className="table-wrap" style={{ borderTop: 'none', marginBottom: 18 }}>
            <table className="simple-table kpi-scorecard-table">
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}></th>
                  {MONTH_LABELS.map((m) => (
                    <th key={m} className="center">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700, position: 'sticky', left: 0, background: 'var(--surface)' }}>Score</td>
                  {scorecard.totalScore.map((s, i) => (
                    <td key={i} className="center mono" style={{ fontWeight: 700 }}>
                      {fmtScore(s)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, position: 'sticky', left: 0, background: 'var(--surface)' }}>Signal</td>
                  {scorecard.totalSignal.map((sig, i) => (
                    <td key={i} className="center">
                      {sig && (
                        <span className={`badge ${SIGNAL_BADGE[sig]}`} title={SIGNAL_LABEL[sig]}>
                          &nbsp;
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {canEditGm && (
            <>
              <div style={{ fontWeight: 600, fontSize: 12.5, margin: '4px 0 8px' }}>Isi Gross Margin — {cabangList[0]}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label>Bulan</label>
                  <select value={gmMonth} onChange={(e) => setGmMonth(e.target.value)} style={{ maxWidth: 130 }}>
                    {MONTH_LABELS.map((m, i) => (
                      <option key={m} value={String(i + 1).padStart(2, '0')}>
                        {m} {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Target (%)</label>
                  <input type="number" step="0.1" value={gmTargetPct} onChange={(e) => setGmTargetPct(e.target.value)} placeholder="cth. 34" style={{ maxWidth: 110 }} />
                </div>
                <div>
                  <label>Hasil Aktual (%)</label>
                  <input type="number" step="0.1" value={gmResultPct} onChange={(e) => setGmResultPct(e.target.value)} placeholder="cth. 32" style={{ maxWidth: 110 }} />
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={savingGm} onClick={onSaveGm}>
                  Simpan
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
