'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { STATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import { addDays, followUpDateProblem, jakartaDate } from '@/lib/followup-rule';
import type { Prospect } from '@/lib/types';
import { useT } from '@/store/useLangStore';

/** Tanggal + catatan follow-up berikutnya, dengan pilihan cepat. Dipakai saat prospek pindah tahap. */
export function FollowUpFields({
  date,
  note,
  onDate,
  onNote,
  showErr,
}: {
  date: string;
  note: string;
  onDate: (v: string) => void;
  onNote: (v: string) => void;
  showErr?: boolean;
}) {
  const tr = useT();
  const today = jakartaDate();
  const problem = followUpDateProblem(date, today);
  const quick: [string, string][] = [
    [tr('Besok'), addDays(today, 1)],
    [tr('+3 hari'), addDays(today, 3)],
    [tr('+1 minggu'), addDays(today, 7)],
    [tr('+2 minggu'), addDays(today, 14)],
  ];
  return (
    <div className="fu-move">
      <div className="fu-field">
        <label>
          {tr('Follow-up berikutnya')} <span style={{ color: 'var(--rust-500)' }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={date} min={today} onChange={(e) => onDate(e.target.value)} className={showErr && problem ? 'req' : ''} style={{ maxWidth: 180, borderColor: showErr && problem ? 'var(--rust-500)' : undefined }} />
          {quick.map(([label, v]) => (
            <button key={label} type="button" className={`btn btn-sm btn-outline${date === v ? ' on' : ''}`} onClick={() => onDate(v)}>
              {label}
            </button>
          ))}
        </div>
        {showErr && problem ? (
          <div className="field-note" style={{ color: 'var(--rust-500)' }}>{tr(problem)}</div>
        ) : (
          <div className="field-note">{date && !problem ? tr('Masuk Aktivitas Harian sebagai rencana pada {tgl}.', { tgl: formatDateID(date) }) : tr('Wajib diisi — kapan customer dihubungi lagi.')}</div>
        )}
      </div>
      <div className="fu-field">
        <label>{tr('Catatan singkat')}</label>
        <input type="text" value={note} maxLength={200} onChange={(e) => onNote(e.target.value)} placeholder={tr('cth. customer minta revisi harga 3%')} />
      </div>
    </div>
  );
}

/** Konfirmasi pindah tahap dari Kanban: status baru + jadwal follow-up dikirim sekaligus. */
export function FollowUpMoveModal({
  prospect,
  toStatus,
  onCancel,
  onConfirm,
}: {
  prospect: Prospect;
  toStatus: number;
  onCancel: () => void;
  onConfirm: (followUpAt: string, followUpNote: string) => Promise<void>;
}) {
  const tr = useT();
  const today = jakartaDate();
  const existing = (prospect.followUpAt || '') >= today ? prospect.followUpAt || '' : '';
  const [date, setDate] = useState(existing);
  const [note, setNote] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (followUpDateProblem(date, today)) return setShowErr(true);
    setSaving(true);
    try {
      await onConfirm(date, note.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      show
      onClose={onCancel}
      title={tr('Pindah ke {tahap}?', { tahap: STATUS_META[toStatus]?.label ?? String(toStatus) })}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
            {tr('Batal')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr('Menyimpan…') : tr('Pindahkan')}
          </button>
        </>
      }
    >
      <p className="field-note" style={{ marginTop: 0, fontSize: 13 }}>
        <b>{prospect.customer}</b> · {formatRupiah(num(prospect.value))} · {STATUS_META[num(prospect.status)]?.label} → <b>{STATUS_META[toStatus]?.label}</b>
      </p>
      <FollowUpFields date={date} note={note} onDate={setDate} onNote={setNote} showErr={showErr} />
    </Modal>
  );
}
