'use client';

import { useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function DeleteConfirmModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'delete';
  const ctx = useUiStore((s) => s.deleteCtx);
  const closeModal = useUiStore((s) => s.closeModal);
  const { removeProspect, removeUser, removeCustomer, removeRfq, toast } = useDataStore();
  const [busy, setBusy] = useState(false);

  if (!ctx) return null;

  async function onConfirm() {
    setBusy(true);
    try {
      if (ctx!.mode === 'user') {
        await api.del(`/api/users/${ctx!.id}`);
        removeUser(ctx!.id);
        toast('User dihapus', 'success');
      } else if (ctx!.mode === 'customer') {
        await api.del(`/api/customers/${ctx!.id}`);
        removeCustomer(ctx!.id);
        toast('Customer dihapus', 'success');
      } else if (ctx!.mode === 'rfq') {
        await api.del(`/api/rfqs/${ctx!.id}`);
        removeRfq(ctx!.id);
        toast('RFQ dihapus', 'success');
      } else {
        await api.del(`/api/prospects/${ctx!.id}`);
        removeProspect(ctx!.id);
        toast('Prospek dihapus', 'success');
      }
      closeModal();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus data', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={ctx.title}
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Batal
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            Hapus
          </button>
        </>
      }
    >
      <p>{ctx.message}</p>
    </Modal>
  );
}
