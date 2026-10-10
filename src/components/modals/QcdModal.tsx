'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { QcdFields, qcdPayload } from '../QcdFields';
import { api } from '@/lib/api-client';
import { STATUS_META } from '@/lib/constants';
import { num } from '@/lib/format';
import { qcdMissing, qcdRequiredOnMove } from '@/lib/qcd';
import { promptItemFlow } from '@/lib/item-flow-prompt';
import { useDataStore } from '@/store/useDataStore';
import { EMPTY_QCD, useUiStore, type PendingQcd } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';

/**
 * QCD for one prospect, opened from the Kanban (a drag into a closing
 * column) or from Rekap QCD (editing a closed deal).
 *
 * Kanban with `commit`: the status has NOT moved yet. Nothing is saved until
 * this modal is submitted, and then status, QCD and (when needed) No. PO go
 * in ONE request -- so a deal can't land in PO/DO/Lose without its QCD, and
 * "Batal" leaves the card where it was. The API enforces the same rule.
 */
export function QcdModal() {
  const show = useUiStore((s) => s.modal === 'qcd');
  const qcdCtx = useUiStore((s) => s.qcdCtx);
  const closeModalRaw = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const returnTo = useUiStore((s) => s.qcdCtx?.returnTo);
  const closeModal = () => (returnTo ? openModal(returnTo) : closeModalRaw());
  const records = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const [qcd, setQcd] = useState<PendingQcd>({ ...EMPTY_QCD });
  const [noPo, setNoPo] = useState('');
  const [busy, setBusy] = useState(false);

  const record = qcdCtx?.recordId ? records.find((x) => x.id === qcdCtx.recordId) || null : null;
  const target = Number(qcdCtx?.statusVal);
  const prev = record ? num(record.status) : null;
  const commit = !!qcdCtx?.commit;
  // Moving into PO/DO also needs a No. PO when none is on file.
  const poRequired = commit && (target === 4 || target === 5) && prev !== target && !(record?.noPo || '').trim();
  // A closing move, or editing a closed deal from Rekap QCD: QCD is mandatory.
  // A move between Won stages (PO -> DO) isn't a new close: QCD optional there.
  const qcdRequired = commit ? qcdRequiredOnMove(prev, target) : [4, 5, 6].includes(target);

  useEffect(() => {
    if (!show || !record) return;
    setQcd({
      quality: record.qcdQuality || '',
      cost: record.qcdCost || '',
      delivery: record.qcdDelivery || '',
      kompetitor: record.qcdKompetitor || '',
      catatan: record.qcdCatatan || '',
      qualityLevel: record.qcdQualityLevel || '',
      costLevel: record.qcdCostLevel || '',
      deliveryLevel: record.qcdDeliveryLevel || '',
      faktor: record.qcdFaktor || '',
    });
    setNoPo(record.noPo || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, qcdCtx]);

  if (!qcdCtx || !record) return null;
  const label = STATUS_META[target]?.label ?? String(target);

  async function onSubmit() {
    if (poRequired && !noPo.trim()) return toast('No. PO wajib diisi sebelum status dipindahkan ke PO/Kontrak atau DO', 'error');
    const payload = qcdPayload(qcd);
    if (qcdRequired) {
      const miss = qcdMissing(target, payload);
      if (miss) return toast(miss, 'error');
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...payload };
      if (commit) body.status = target;
      if (poRequired) body.noPo = noPo.trim();
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${record!.id}`, body);
      upsertProspect(prospect);
      closeModal();
      toast(commit ? `Status pindah ke ${label} · QCD tersimpan` : 'Data QCD tersimpan', 'success');
      if (commit && !returnTo) promptItemFlow(prev, prospect);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Quality · Cost · Delivery"
      wide
      onSubmit={onSubmit}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {commit ? 'Simpan & Pindahkan' : 'Simpan QCD'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, marginBottom: 14, color: 'var(--text-soft)', fontSize: 12.5 }}>
        <b>{record.customer}</b> —{' '}
        {commit ? (
          <>
            status akan pindah ke <b>{target} · {label}</b> setelah {poRequired ? 'No. PO dan ' : ''}QCD diisi. Kartu tetap di kolom semula bila dibatalkan.
          </>
        ) : (
          <>status {label}. Lengkapi QCD untuk evaluasi menang/kalah.</>
        )}
      </p>
      {poRequired && (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="full">
            <label>
              No. PO / Kontrak <span style={{ color: 'var(--rust-500)' }}>*</span>
            </label>
            <input type="text" autoFocus value={noPo} onChange={(e) => setNoPo(e.target.value)} placeholder="cth. PO-2026-00123" />
          </div>
        </div>
      )}
      <QcdFields value={qcd} onChange={setQcd} statusVal={target} required={qcdRequired} />
    </Modal>
  );
}
