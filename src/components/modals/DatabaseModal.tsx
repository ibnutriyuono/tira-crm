'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconSave, IconUpload } from '../icons';
import { api } from '@/lib/api-client';
import { pendingDbImport, type DbBackupPayload } from '@/lib/pending-db-import';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

interface Stats {
  prospects: number;
  customers: number;
  rfqs: number;
  users: number;
}

export function DatabaseModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'database';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const toast = useDataStore((s) => s.toast);

  const [stats, setStats] = useState<Stats | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!show) return;
    api.get<Stats>('/api/database/stats').then(setStats).catch(() => {});
  }, [show]);

  async function saveAllNow() {
    await Promise.all([useDataStore.getState().refetchProspects(), useDataStore.getState().refetchCustomers()]);
    toast('Semua perubahan berhasil disimpan', 'success');
  }

  async function exportBackup() {
    const backup = await api.get<Record<string, unknown>>('/api/database/export');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `CRM_Database_Backup_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Database berhasil diexport. Pilih lokasi penyimpanan pada dialog unduhan browser Anda.', 'success');
  }

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(String(e.target?.result || '')) as DbBackupPayload;
        if (!data || !Array.isArray(data.prospects)) {
          toast('File backup tidak valid: format tidak dikenali.', 'error');
          return;
        }
        pendingDbImport.set(data);
        openModal('dbImportConfirm');
      } catch {
        toast('Gagal membaca file backup. Pastikan file .json valid.', 'error');
      }
    };
    reader.readAsText(file);
  }

  return (
    <Modal show={show} onClose={closeModal} title="Kelola Database" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="import-summary" style={{ marginBottom: 14 }}>
        {stats ? (
          <>
            Total Prospek: <b>{stats.prospects}</b> &nbsp;|&nbsp; Total Customer: <b>{stats.customers}</b> &nbsp;|&nbsp; Total RFQ: <b>{stats.rfqs}</b> &nbsp;|&nbsp; Total User: <b>{stats.users}</b>
            <br />
            Penyimpanan: <b>PostgreSQL (realtime, tersinkron ke semua user)</b>
          </>
        ) : (
          'Memuat statistik...'
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={saveAllNow}>
          <IconSave /> Simpan Sekarang
        </button>
        <button type="button" className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={exportBackup}>
          <IconDownload /> Export Database (.json) — pilih lokasi penyimpanan sendiri
        </button>
        <div
          className={`drop-zone${dragging ? ' drag' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
          }}
        >
          <IconUpload />
          <div>Klik atau tarik file backup .json ke sini untuk Import / Restore</div>
          <div className="file-name">{fileName}</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.[0]) handleFile(e.target.files[0]);
          }}
        />
      </div>
      <div className="import-summary" style={{ marginTop: 14 }}>
        Catatan: file hasil Export dapat disimpan di lokasi mana pun sesuai pilihan Anda saat dialog unduhan muncul — folder komputer, Google Drive, USB, dsb — sebagai cadangan database di luar penyimpanan aplikasi. Gunakan Import untuk memulihkan seluruh data dari file cadangan tersebut kapan saja.
      </div>
    </Modal>
  );
}

