'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CABANG_LIST } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Customer } from '@/lib/types';

export function CustomerFormModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customerForm';
  const customerEditId = useUiStore((s) => s.customerEditId);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const customers = useDataStore((s) => s.customers);
  const records = useDataStore((s) => s.prospects);
  const upsertCustomer = useDataStore((s) => s.upsertCustomer);
  const toast = useDataStore((s) => s.toast);

  const editing = customerEditId ? customers.find((c) => c.id === customerEditId) || null : null;

  const [name, setName] = useState('');
  const [cabang, setCabang] = useState('');
  const [pic, setPic] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setName(editing.name || '');
      setCabang(editing.cabang || '');
      setPic(editing.pic || '');
      setPhone(editing.phone || '');
      setEmail(editing.email || '');
      setAddress(editing.address || '');
      setCatatan(editing.catatan || '');
    } else {
      setName('');
      setCabang('');
      setPic('');
      setPhone('');
      setEmail('');
      setAddress('');
      setCatatan('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, customerEditId]);

  const cabangOptions = useMemo(() => Array.from(new Set([...CABANG_LIST, ...records.map((r) => r.cabang).filter(Boolean)])) as string[], [records]);

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return toast('Nama customer wajib diisi', 'error');
    setBusy(true);
    const payload = { name: trimmed, cabang, pic, phone, email, address, catatan };
    try {
      const { customer } = customerEditId ? await api.put<{ customer: Customer }>(`/api/customers/${customerEditId}`, payload) : await api.post<{ customer: Customer }>('/api/customers', payload);
      upsertCustomer(customer);
      closeModal();
      openModal('customers');
      toast(customerEditId ? 'Perubahan customer disimpan' : 'Customer baru ditambahkan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan customer', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={() => {
        closeModal();
        openModal('customers');
      }}
      title={customerEditId ? 'Edit Customer' : 'Tambah Customer'}
      onSubmit={onSubmit}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              closeModal();
              openModal('customers');
            }}
          >
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Simpan Customer
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="full">
          <label>Nama Customer *</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Cabang</label>
          <input list="cabangList3" value={cabang} onChange={(e) => setCabang(e.target.value)} />
          <datalist id="cabangList3">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label>PIC / Kontak</label>
          <input type="text" value={pic} onChange={(e) => setPic(e.target.value)} placeholder="Nama penanggung jawab" />
        </div>
        <div>
          <label>No. Telp / WhatsApp</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="cth. 08123456789" />
        </div>
        <div>
          <label>Email</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" />
        </div>
        <div className="full">
          <label>Alamat</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Alamat lengkap customer" />
        </div>
        <div className="full">
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional)" />
        </div>
      </div>
    </Modal>
  );
}
