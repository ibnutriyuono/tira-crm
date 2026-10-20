'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa, Rfq } from '@/lib/types';

import { useT } from '@/store/useLangStore';
/**
 * Membatalkan RFQ/FUP A — dokumennya tidak dihapus, hanya berubah status
 * jadi "Dibatalkan" beserta alasannya, jadi riwayatnya tetap terbaca.
 * Modal yang sama dipakai untuk mengaktifkan kembali dokumen yang salah
 * dibatalkan.
 */
export function CancelDocModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'cancelDoc';
  const ctx = useUiStore((s) => s.cancelDocCtx);
  const closeModal = useUiStore((s) => s.closeModal);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const upsertFupa = useDataStore((s) => s.upsertFupa);
  const toast = useDataStore((s) => s.toast);

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setReason('');
  }, [show, ctx?.id]);

  if (!ctx) return null;
  const label = ctx.jenis === 'RFQ' ? 'RFQ' : 'FUP A';
  const base = ctx.jenis === 'RFQ' ? '/api/rfqs' : '/api/fupas';

  async function submit() {
    if (!ctx!.cancelled && reason.trim().length < 5) {
      toast('Alasan pembatalan wajib diisi (minimal 5 karakter).', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = ctx!.cancelled ? { undo: true } : { reason: reason.trim() };
      const res = await api.post<{ rfq?: Rfq; fupa?: Fupa }>(`${base}/${ctx!.id}/cancel`, payload);
      if (res.rfq) upsertRfq(res.rfq);
      if (res.fupa) upsertFupa(res.fupa);
      toast(ctx!.cancelled ? `${label} diaktifkan kembali` : `${label} dibatalkan`, 'success');
      closeModal();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memproses pembatalan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={ctx.cancelled ? `Aktifkan Kembali ${label}` : `Batalkan ${label}`}
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {tr("Tutup")}
          </button>
          <button type="button" className={ctx.cancelled ? 'btn btn-primary' : 'btn btn-danger'} onClick={submit} disabled={busy || (!ctx.cancelled && reason.trim().length < 5)}>
            {ctx.cancelled ? tr("Aktifkan Kembali") : tr("Batalkan")}
          </button>
        </>
      }
    >
      {ctx.cancelled ? (
        <p>
          {tr("Aktifkan kembali")} {label} <b>{ctx.noDoc || tr("(tanpa nomor)")}</b> {tr("untuk")} {ctx.customer || '-'}{tr("? Statusnya akan kembali mengikuti progres terakhir, dan catatan pembatalan sebelumnya dihapus.")}
        </p>
      ) : (
        <>
          <p>
            {tr("Batalkan")} {label} <b>{ctx.noDoc || tr("(tanpa nomor)")}</b> {tr("untuk")} {ctx.customer || '-'}?
          </p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="full">
              <label>{tr("Alasan Pembatalan *")}</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("cth. Customer membatalkan permintaan, duplikat dengan RFQ-0012, salah input...")} autoFocus />
              <div className="field-note">
                {tr("Wajib diisi (minimal 5 karakter). Dokumen")} <b>{tr("tidak dihapus")}</b> {tr("— statusnya berubah jadi \"Dibatalkan\" dan tetap tampil di daftar beserta alasan, nama pembatal, dan waktunya. Bisa diaktifkan kembali kalau ternyata salah.")}
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
