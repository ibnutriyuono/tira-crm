'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';

export function QcdModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'qcd';
  const qcdCtx = useUiStore((s) => s.qcdCtx);
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const [quality, setQuality] = useState('');
  const [cost, setCost] = useState('');
  const [delivery, setDelivery] = useState('');
  const [kompetitor, setKompetitor] = useState('');
  const [catatan, setCatatan] = useState('');
  const [noPo, setNoPo] = useState('');
  const [busy, setBusy] = useState(false);

  const kanbanRecord = qcdCtx?.mode === 'kanban' ? records.find((x) => x.id === qcdCtx.recordId) : null;
  // Kanban's handleDrop only opens this modal WITHOUT having moved the
  // status yet when it's gating a move into PO/Kontrak or DO on a prospect
  // that has no No. PO on file — see the comment there. In that case this
  // modal is the one place status actually gets committed, together with
  // the now-mandatory No. PO. Any other kanban open (status already moved
  // by handleDrop, or a status-6 Lose Order) keeps the old, purely-optional
  // QCD flow untouched.
  const poRequired = !!kanbanRecord && (Number(qcdCtx?.statusVal) === 4 || Number(qcdCtx?.statusVal) === 5) && !(kanbanRecord.noPo || '').trim();

  useEffect(() => {
    if (!show || !qcdCtx) return;
    if (qcdCtx.mode === 'prospectForm') {
      const d = useUiStore.getState().pendingProspectQCD;
      setQuality(d.quality);
      setCost(d.cost);
      setDelivery(d.delivery);
      setKompetitor(d.kompetitor);
      setCatatan(d.catatan);
    } else if (qcdCtx.mode === 'kanban' && qcdCtx.recordId) {
      const r = records.find((x) => x.id === qcdCtx.recordId);
      setQuality(r?.qcdQuality || '');
      setCost(r?.qcdCost || '');
      setDelivery(r?.qcdDelivery || '');
      setKompetitor(r?.qcdKompetitor || '');
      setCatatan(r?.qcdCatatan || '');
      setNoPo(r?.noPo || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, qcdCtx]);

  if (!qcdCtx) return null;
  const label = Number(qcdCtx.statusVal) === 4 ? 'PO / Kontrak' : Number(qcdCtx.statusVal) === 5 ? 'DO' : 'Lose Order / Batal';

  async function onSubmit() {
    const data = { quality: quality.trim(), cost: cost.trim(), delivery: delivery.trim(), kompetitor: kompetitor.trim(), catatan: catatan.trim() };
    if (qcdCtx!.mode === 'prospectForm') {
      useUiStore.setState({ pendingProspectQCD: data });
      closeModal();
      toast('Data QCD disimpan bersama prospek saat form disimpan', 'success');
      return;
    }
    if (qcdCtx!.mode === 'kanban' && qcdCtx!.recordId) {
      if (poRequired && !noPo.trim()) {
        toast('No. PO wajib diisi sebelum status dipindahkan ke PO/Kontrak atau DO', 'error');
        return;
      }
      setBusy(true);
      try {
        const patchBody: Record<string, unknown> = {
          qcdQuality: data.quality,
          qcdCost: data.cost,
          qcdDelivery: data.delivery,
          qcdKompetitor: data.kompetitor,
          qcdCatatan: data.catatan,
        };
        // Status was deliberately held back by handleDrop until now — commit
        // it together with the No. PO that gated it, in the same request.
        if (poRequired) {
          patchBody.status = qcdCtx!.statusVal;
          patchBody.noPo = noPo.trim();
        }
        const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${qcdCtx!.recordId}`, patchBody);
        upsertProspect(prospect);
        closeModal();
        toast(poRequired ? 'Status & No. PO tersimpan' : 'Data QCD tersimpan', 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Detail Quality · Cost · Delivery"
      wide
      onSubmit={onSubmit}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {poRequired ? 'Batal' : 'Lewati'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {poRequired ? 'Simpan & Pindahkan' : 'Simpan QCD'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, marginBottom: 14, color: 'var(--text-soft)', fontSize: 12.5 }}>
        {poRequired ? (
          <>Status pipeline akan pindah ke <b>{qcdCtx.statusVal} · {label}</b> setelah No. PO diisi — kartu tetap di kolom semula sampai itu terisi. Detail QCD di bawah ini opsional.</>
        ) : (
          <>Status pipeline berubah menjadi <b>{qcdCtx.statusVal} · {label}</b>. Mohon lengkapi detail berikut untuk arsip evaluasi:</>
        )}
      </p>
      <div className="form-grid">
        {poRequired && (
          <div className="full">
            <label>No. PO / Kontrak <span style={{ color: 'var(--rust-500)' }}>*</span></label>
            <input type="text" autoFocus value={noPo} onChange={(e) => setNoPo(e.target.value)} placeholder="cth. PO-2026-00123" />
            <div className="field-note">Wajib diisi sebelum status pindah ke {label}</div>
          </div>
        )}
        <div>
          <label>Quality</label>
          <input type="text" value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="cth. Sesuai spesifikasi / ada revisi" />
        </div>
        <div>
          <label>Cost</label>
          <input type="text" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="cth. Kompetitif / kalah harga 5%" />
        </div>
        <div>
          <label>Delivery</label>
          <input type="text" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="cth. Sesuai jadwal / lebih cepat" />
        </div>
        <div>
          <label>Kompetitor</label>
          <input type="text" value={kompetitor} onChange={(e) => setKompetitor(e.target.value)} placeholder="Nama kompetitor (jika ada)" />
        </div>
        <div className="full">
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan terkait keputusan customer" />
        </div>
      </div>
    </Modal>
  );
}
