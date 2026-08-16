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
  const [busy, setBusy] = useState(false);

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, qcdCtx]);

  if (!qcdCtx) return null;
  const label = Number(qcdCtx.statusVal) === 4 ? 'PO / Kontrak' : 'Lose Order / Batal';

  async function onSubmit() {
    const data = { quality: quality.trim(), cost: cost.trim(), delivery: delivery.trim(), kompetitor: kompetitor.trim(), catatan: catatan.trim() };
    if (qcdCtx!.mode === 'prospectForm') {
      useUiStore.setState({ pendingProspectQCD: data });
      closeModal();
      toast('Data QCD disimpan bersama prospek saat form disimpan', 'success');
      return;
    }
    if (qcdCtx!.mode === 'kanban' && qcdCtx!.recordId) {
      setBusy(true);
      try {
        const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${qcdCtx!.recordId}`, {
          qcdQuality: data.quality,
          qcdCost: data.cost,
          qcdDelivery: data.delivery,
          qcdKompetitor: data.kompetitor,
          qcdCatatan: data.catatan,
        });
        upsertProspect(prospect);
        closeModal();
        toast('Data QCD tersimpan', 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Gagal menyimpan QCD', 'error');
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
            Lewati
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Simpan QCD
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, marginBottom: 14, color: 'var(--text-soft)', fontSize: 12.5 }}>
        Status pipeline berubah menjadi <b>{qcdCtx.statusVal} · {label}</b>. Mohon lengkapi detail berikut untuk arsip evaluasi:
      </p>
      <div className="form-grid">
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
