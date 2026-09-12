'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconCheck, IconEdit, IconWa } from '../icons';
import { api } from '@/lib/api-client';
import { formatDateID } from '@/lib/format';
import { buildFollowUpRows, type FollowUpRow, type FollowUpSource } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';

const SOURCE_META: Record<FollowUpSource, { label: string; color: string }> = {
  terjadwal: { label: 'Terjadwal', color: 'steel' },
  aging: { label: 'Pipeline Mangkrak', color: 'amber' },
  reaktivasi: { label: 'Customer Dingin', color: 'rust' },
};

/**
 * Deliberately built as a merge of three EXISTING signals rather than a
 * fourth standalone list — buildAgingList (Forecast's stale-pipeline check)
 * and buildCustomerIntel (Marketing's Reaktivasi tab) already compute who
 * needs attention; duplicating that logic here would just give Sales a
 * second, slightly-different answer to the same question. Scheduling
 * (`Prospect.followUpAt/followUpNote`) is the one genuinely new thing —
 * everything else is these two builders re-shaped into one sorted worklist.
 *
 * No cron job creates a "your follow-up is due" notification — this app has
 * no background scheduler, and the existing Aging/Reaktivasi signals are
 * likewise computed live off current data, not pushed. Consistent with
 * that, due dates are evaluated fresh every time this dashboard opens.
 */
export function FollowUpBoardModal() {
  const show = useUiStore((s) => s.modal === 'followUpBoard');
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const [showAll, setShowAll] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [draftDate, setDraftDate] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const all = buildFollowUpRows(prospects);
    return showAll ? all : all.filter((r) => r.tier !== 'nanti');
  }, [prospects, showAll]);
  // Independent of the showAll filter — the checkbox label needs the true
  // total ("masih jauh (12)") whether or not that tier is currently shown.
  const nantiCount = useMemo(() => buildFollowUpRows(prospects).filter((r) => r.tier === 'nanti').length, [prospects]);

  const segera = rows.filter((r) => r.tier === 'terlambat');
  const mingguIni = rows.filter((r) => r.tier === 'minggu-ini');
  const nanti = rows.filter((r) => r.tier === 'nanti');

  function openFollowUp(p: Prospect) {
    useUiStore.setState({ followUpCtx: { type: 'prospect', id: p.id } });
    closeModal();
    openModal('followUp');
  }
  function openProspect(p: Prospect) {
    useUiStore.setState({ editProspectId: p.id });
    closeModal();
    openModal('prospectForm');
  }

  async function saveSchedule(p: Prospect) {
    const date = draftDate[p.id];
    if (!date) return;
    setSavingId(p.id);
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${p.id}`, { followUpAt: date });
      upsertProspect(prospect);
      toast(`Follow-up ${p.customer} dijadwalkan ${formatDateID(date)}`, 'success');
      setDraftDate((d) => ({ ...d, [p.id]: '' }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menjadwalkan follow-up', 'error');
    } finally {
      setSavingId('');
    }
  }

  function renderRow(r: FollowUpRow) {
    const meta = SOURCE_META[r.source];
    return (
      <div key={r.key} className="followup-row">
        <span className={`badge ${meta.color}`}>{meta.label}</span>
        <div className="followup-body" onClick={() => openProspect(r.prospect)}>
          <div className="followup-customer">
            {r.customer} <span className="field-note" style={{ display: 'inline' }}>· {r.cabang}</span>
          </div>
          <div className="followup-reason">{r.reason}</div>
          <div className="followup-detail">{r.detail}</div>
        </div>
        <div className="followup-actions">
          <button type="button" className="btn btn-wa btn-sm" onClick={() => openFollowUp(r.prospect)} title="Follow Up via WhatsApp">
            <IconWa /> Follow Up
          </button>
          <input
            type="date"
            className="followup-date-input"
            value={draftDate[r.prospect.id] ?? ''}
            onChange={(e) => setDraftDate((d) => ({ ...d, [r.prospect.id]: e.target.value }))}
          />
          <button
            type="button"
            className="icon-btn"
            title="Jadwalkan follow-up berikutnya"
            disabled={savingId === r.prospect.id || !draftDate[r.prospect.id]}
            onClick={() => saveSchedule(r.prospect)}
          >
            <IconCheck />
          </button>
          <button type="button" className="icon-btn" title="Buka prospek" onClick={() => openProspect(r.prospect)}>
            <IconEdit />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Follow-up"
      wide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      <div className="import-summary" style={{ marginBottom: 14 }}>
        Menyatukan tiga sinyal: <b>terjadwal manual</b>, <b>pipeline yang mangkrak</b> (dari Forecast), dan{' '}
        <b>customer yang mulai/sudah dingin</b> (dari Marketing) — satu tempat untuk tahu siapa yang perlu dihubungi hari ini.
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi rust">
          <div className="label">Perlu Segera</div>
          <div className="value">{segera.length}</div>
        </div>
        <div className="kpi amber">
          <div className="label">Minggu Ini</div>
          <div className="value">{mingguIni.length}</div>
        </div>
      </div>

      <div className="toolbar-row" style={{ marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Tampilkan juga jadwal yang masih jauh ({nantiCount})
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <h3>Tidak ada yang perlu di-follow-up</h3>
          <p>Semua pipeline bergerak dan tidak ada customer yang mulai dingin. Kerja bagus!</p>
        </div>
      ) : (
        <>
          {segera.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 12.5, margin: '14px 0 6px' }}>Perlu Segera</div>
              <div className="followup-list">{segera.map(renderRow)}</div>
            </>
          )}
          {mingguIni.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 6px' }}>Jatuh Tempo Minggu Ini</div>
              <div className="followup-list">{mingguIni.map(renderRow)}</div>
            </>
          )}
          {showAll && nanti.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 6px' }}>Terjadwal — Masih Jauh</div>
              <div className="followup-list">{nanti.map(renderRow)}</div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
