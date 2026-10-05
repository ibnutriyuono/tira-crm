'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconPlus, IconTrash } from '../icons';
import { CABANG_LIST } from '@/lib/constants';
import { uid } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Customer, CustomerPic } from '@/lib/types';

/** One editable row in the PIC list — same shape as CustomerPic, but `id` is
 * always present (client-generated for a brand new row) so rows have a
 * stable React key even before the server assigns a real id on save. */
type PicRow = Omit<CustomerPic, 'jabatan' | 'phone' | 'email'> & { jabatan: string; phone: string; email: string };

function picRowsFromCustomer(c: Customer | null): PicRow[] {
  if (c?.pics && c.pics.length > 0) {
    return c.pics.map((p) => ({ id: p.id, nama: p.nama, jabatan: p.jabatan || '', phone: p.phone || '', email: p.email || '', isPrimary: p.isPrimary }));
  }
  // Pre-fill one row from the legacy single pic/phone/email so editing an
  // old customer still shows its existing contact, now in the new editor.
  if (c && (c.pic || c.phone || c.email)) {
    return [{ id: uid(), nama: c.pic || '', jabatan: '', phone: c.phone || '', email: c.email || '', isPrimary: true }];
  }
  return [{ id: uid(), nama: '', jabatan: '', phone: '', email: '', isPrimary: true }];
}

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
  const [pics, setPics] = useState<PicRow[]>([]);
  const [address, setAddress] = useState('');
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setName(editing.name || '');
      setCabang(editing.cabang || '');
      setAddress(editing.address || '');
      setCatatan(editing.catatan || '');
    } else {
      setName('');
      setCabang('');
      setAddress('');
      setCatatan('');
    }
    setPics(picRowsFromCustomer(editing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, customerEditId]);

  function addPicRow() {
    setPics((list) => [...list, { id: uid(), nama: '', jabatan: '', phone: '', email: '', isPrimary: list.length === 0 }]);
  }
  function removePicRow(id: string) {
    setPics((list) => {
      const next = list.filter((p) => p.id !== id);
      // Removing the primary row hands the flag to whichever is now first,
      // so there's always exactly one primary as long as a row remains.
      if (next.length > 0 && !next.some((p) => p.isPrimary)) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
  }
  function updatePicRow(id: string, patch: Partial<PicRow>) {
    setPics((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function makePrimary(id: string) {
    setPics((list) => list.map((p) => ({ ...p, isPrimary: p.id === id })));
  }

  const cabangOptions = useMemo(() => Array.from(new Set([...CABANG_LIST, ...records.map((r) => r.cabang).filter(Boolean)])) as string[], [records]);

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return toast('Nama customer wajib diisi', 'error');
    setBusy(true);
    // Blank rows (no nama typed) are dropped server-side by
    // normalizeCustomerPics, so an untouched "+ Tambah PIC" row is harmless.
    const payload = { name: trimmed, cabang, pics, address, catatan };
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
        <div className="full" style={{ marginTop: 6 }}>
          <label>PIC / Kontak</label>
          {pics.map((p) => (
            <div className="rfq-item-card" key={p.id}>
              <div className="rfq-item-head">
                <span>{p.isPrimary ? 'PIC Utama' : 'PIC'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!p.isPrimary && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => makePrimary(p.id)}>
                      Jadikan Utama
                    </button>
                  )}
                  <button type="button" className="icon-btn danger" disabled={pics.length <= 1} onClick={() => removePicRow(p.id)} title="Hapus PIC">
                    <IconTrash />
                  </button>
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label>Nama</label>
                  <input type="text" value={p.nama} onChange={(e) => updatePicRow(p.id, { nama: e.target.value })} placeholder="Nama penanggung jawab" />
                </div>
                <div>
                  <label>Jabatan</label>
                  <input type="text" value={p.jabatan} onChange={(e) => updatePicRow(p.id, { jabatan: e.target.value })} placeholder="cth. Purchasing Manager" />
                </div>
                <div>
                  <label>No. Telp / WhatsApp</label>
                  <input type="text" value={p.phone} onChange={(e) => updatePicRow(p.id, { phone: e.target.value })} placeholder="cth. 08123456789" />
                </div>
                <div>
                  <label>Email</label>
                  <input type="text" value={p.email} onChange={(e) => updatePicRow(p.id, { email: e.target.value })} placeholder="nama@perusahaan.com" />
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={addPicRow}>
            <IconPlus /> Tambah PIC
          </button>
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
