'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Vendor } from '@/lib/types';

export function VendorFormModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'vendorForm';
  const vendorEditId = useUiStore((s) => s.vendorEditId);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const vendors = useDataStore((s) => s.vendors);
  const upsertVendor = useDataStore((s) => s.upsertVendor);
  const toast = useDataStore((s) => s.toast);

  const editing = vendorEditId ? vendors.find((v) => v.id === vendorEditId) || null : null;

  const [nama, setNama] = useState('');
  const [pic, setPic] = useState('');
  const [wa, setWa] = useState('');
  const [email, setEmail] = useState('');
  const [kategori, setKategori] = useState('');
  const [alamat, setAlamat] = useState('');
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setNama(editing?.nama || '');
    setPic(editing?.pic || '');
    setWa(editing?.wa || '');
    setEmail(editing?.email || '');
    setKategori(editing?.kategori || '');
    setAlamat(editing?.alamat || '');
    setCatatan(editing?.catatan || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, vendorEditId]);

  async function onSubmit() {
    const trimmed = nama.trim();
    if (!trimmed) return toast('Nama vendor wajib diisi', 'error');

    setBusy(true);
    try {
      const payload = { nama: trimmed, pic, wa, email, kategori, alamat, catatan };
      const { vendor } = editing
        ? await api.put<{ vendor: Vendor }>(`/api/vendors/${editing.id}`, payload)
        : await api.post<{ vendor: Vendor }>('/api/vendors', payload);
      upsertVendor(vendor);
      toast(editing ? 'Vendor diperbarui' : 'Vendor ditambahkan', 'success');
      openModal('vendors');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan vendor', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={editing ? 'Edit Vendor' : 'Tambah Vendor'}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={() => openModal('vendors')}>Batal</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onSubmit}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Nama Vendor</label>
          <input type="text" required value={nama} onChange={(e) => setNama(e.target.value)} placeholder="cth. PT. Baja Sejahtera" />
        </div>
        <div>
          <label>PIC</label>
          <input type="text" value={pic} onChange={(e) => setPic(e.target.value)} placeholder="cth. Bapak Budi" />
        </div>
        <div>
          <label>Kategori</label>
          <input type="text" value={kategori} onChange={(e) => setKategori(e.target.value)} placeholder="cth. Plate, Round Bar" />
        </div>
        <div>
          <label>No. WhatsApp</label>
          <input type="text" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="cth. 08123456789" />
        </div>
        <div>
          <label>Email</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sales@vendor.com" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Alamat</label>
          <input type="text" value={alamat} onChange={(e) => setAlamat(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
      </div>
      <div className="import-summary">
        Nomor WhatsApp dan email dipakai saat mengirim permintaan penawaran ke vendor, jadi pastikan setidaknya salah satunya terisi.
      </div>
    </Modal>
  );
}
