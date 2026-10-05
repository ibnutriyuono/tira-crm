'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { ACTIVITY_TYPES, type ActivityTipe } from '@/lib/constants';
import { buildActivityKpi } from '@/lib/activity-kpi';
import { localToday } from '@/lib/sales-activity';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { ActivityTarget, SalesActivity } from '@/lib/types';

const SIGNAL_BADGE: Record<string, string> = { blue: 'steel', green: 'green', yellow: 'amber', red: 'rust' };
const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);

/**
 * KPI Aktivitas: per-salesperson activity count vs target for one month, plus
 * how many activities were pushed into the pipeline. Deliberately separate
 * from the weighted KPI Scorecard (its weights are management's and unchanged).
 * Targets are editable by admin / GM / RM / BM only.
 */
export function ActivityKpiModal() {
  const show = useUiStore((s) => s.modal === 'activityKpi');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  const canSetTarget = ['admin', 'gm', 'rm', 'bm'].includes(currentUser?.role || '');

  const [periode, setPeriode] = useState(localToday().slice(0, 7));
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [targets, setTargets] = useState<ActivityTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSe, setEditSe] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(periode)) return;
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${periode}`),
        api.get<{ targets: ActivityTarget[] }>(`/api/activity-targets?periode=${periode}`),
      ]);
      setActivities(a.activities);
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
      void load();
    }
  }, [show, load]);

  // Managers also see SEs with no activity/target yet (known from the pipeline
  // they can already see), so a quiet SE shows as 0% instead of vanishing.
  const rows = useMemo(() => {
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
    return buildActivityKpi(activities, Array.from(known.values()), prospects);
  }, [activities, targets, prospects, periode, canSetTarget]);

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

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="KPI Aktivitas Sales"
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      <div className="toolbar-row" style={{ marginBottom: 10 }}>
        <label style={{ margin: 0 }}>Periode</label>
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
        {loading && <span className="field-note">Memuat…</span>}
      </div>
      <div className="field-note" style={{ marginBottom: 10 }}>
        Pencapaian = jumlah aktivitas ÷ target per jenis. Skor total = rata-rata pencapaian tiap jenis (maks. 100% per jenis). Terpisah dari KPI Scorecard.
        Target bertanda &quot;default&quot; belum diatur manajer. Konversi dihitung dari status terkini Prospek hasil klik tombol di Aktivitas Harian.
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">Belum ada aktivitas atau target pada periode ini.</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>SE</th>
                {ACTIVITY_TYPES.map((t) => (
                  <th key={t.key} title={t.label}>
                    {t.short}
                  </th>
                ))}
                <th>Skor</th>
                <th title="Jumlah hari dengan minimal satu aktivitas">Hari</th>
                <th>Ke pipeline</th>
                <th title="Dari aktivitas yang masuk pipeline: sampai Permintaan · Penawaran · PO/DO (status terkini)">Minta · Tawar · PO</th>
                {canSetTarget && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cur = Object.fromEntries(r.types.map((t) => [t.tipe, t.target])) as Record<ActivityTipe, number>;
                return (
                  <tr key={r.se}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{r.se}</strong>
                      {r.cabang && <div className="field-note">{r.cabang}</div>}
                    </td>
                    {r.types.map((t) => (
                      <td key={t.tipe} style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${SIGNAL_BADGE[t.signal || ''] || 'slate'}`}>
                          {t.result}/{t.target} ({pct(t.achieve)})
                        </span>
                        {!t.targetSet && <div className="field-note">default</div>}
                      </td>
                    ))}
                    <td>
                      <span className={`badge ${SIGNAL_BADGE[r.signal || ''] || 'slate'}`}>{pct(r.overall)}</span>
                    </td>
                    <td>{r.activeDays}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.converted}/{r.total} ({pct(r.conversionRate)})
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.toRequest} · {r.toQuote} · <b>{r.toPo}</b>
                    </td>
                    {canSetTarget && (
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }} title="Atur target aktivitas SE ini" onClick={() => startEdit(r.se, cur)}>
                          Target
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editSe && (
        <div className="rfq-item-card" style={{ marginTop: 12 }}>
          <div className="rfq-item-head">
            <strong>
              Target {editSe} — {periode}
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
                Simpan target
              </button>{' '}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditSe(null)}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
