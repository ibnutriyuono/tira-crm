'use client';

import { useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID } from '@/lib/format';
import { api } from '@/lib/api-client';
import { pendingDbImport } from '@/lib/pending-db-import';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function DbImportConfirmModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'dbImportConfirm';
  const closeModal = useUiStore((s) => s.closeModal);
  const toast = useDataStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const data = pendingDbImport.get();
  if (!data) return null;

  const tgl = data.exportedAt ? formatDateID(String(data.exportedAt).slice(0, 10)) : '-';
  const summary = `File berisi ${data.prospects.length} prospek, ${(data.customers || []).length} customer, ${(data.rfqs || []).length} RFQ, ${(data.users || []).length} user. Tanggal export: ${tgl}.`;

  async function onConfirm() {
    setBusy(true);
    try {
      await api.post('/api/database/import', data);
      await useDataStore.getState().bootstrap();
      pendingDbImport.set(null);
      closeModal();
      toast('Database berhasil dipulihkan dari file backup', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memulihkan database', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Pulihkan Database dari Backup"
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Batal
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>
            Ya, Pulihkan Database
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>{summary}</p>
      <p style={{ color: 'var(--rust-600)', fontWeight: 600, fontSize: 13 }}>Tindakan ini akan mengganti seluruh data prospek, customer, dan user saat ini dengan isi file backup. Tindakan tidak dapat dibatalkan.</p>
    </Modal>
  );
}
