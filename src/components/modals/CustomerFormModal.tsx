'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { IconPlus, IconTrash } from '../icons';
import { CABANG_LIST, CUSTOMER_APLIKASI, CUSTOMER_SEGMENTS, PIC_PERAN } from '@/lib/constants';
import { uid } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Customer, CustomerPic } from '@/lib/types';

import { useT } from '@/store/useLangStore';
/** One editable row in the PIC list — same shape as CustomerPic, but `id` is
 * always present (client-generated for a brand new row) so rows have a
 * stable React key even before the server assigns a real id on save. */
type PicRow = Omit<CustomerPic, 'jabatan' | 'phone' | 'email' | 'peran'> & { jabatan: string; phone: string; email: string; peran: string };

function picRowsFromCustomer(c: Customer | null): PicRow[] {
  if (c?.pics && c.pics.length > 0) {
    return c.pics.map((p) => ({ id: p.id, nama: p.nama, jabatan: p.jabatan || '', phone: p.phone || '', email: p.email || '', isPrimary: p.isPrimary, peran: p.peran || '' }));
  }
  // Pre-fill one row from the legacy single pic/phone/email so editing an
  // old customer still shows its existing contact, now in the new editor.
  if (c && (c.pic || c.phone || c.email)) {
    return [{ id: uid(), nama: c.pic || '', jabatan: '', phone: c.phone || '', email: c.email || '', isPrimary: true, peran: '' }];
  }
  return [{ id: uid(), nama: '', jabatan: '', phone: '', email: '', isPrimary: true, peran: '' }];
}

/** "1.500.000.000" dari angka; kosong bila 0/null. */
const fmtPotensi = (n: number | null | undefined) => (n && n > 0 ? Math.round(n).toLocaleString('id-ID') : '');

export function CustomerFormModal() {
  const tr = useT();
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
  const [segmen, setSegmen] = useState('');
  const [aplikasi, setAplikasi] = useState<string[]>([]);
  const [potensi, setPotensi] = useState('');
  const [kompetitor, setKompetitor] = useState('');
  const [busy, setBusy] = useState(false);
  const returnTo = useUiStore((s) => s.customerFormReturnTo) || 'customers';

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setName(editing.name || '');
      setCabang(editing.cabang || '');
      setAddress(editing.address || '');
      setCatatan(editing.catatan || '');
      setSegmen(editing.segmen || '');
      setAplikasi(Array.isArray(editing.aplikasi) ? editing.aplikasi : []);
      setPotensi(fmtPotensi(editing.potensi));
      setKompetitor(editing.kompetitor || '');
    } else {
      setName('');
      setCabang('');
      setAddress('');
      setCatatan('');
      setSegmen('');
      setAplikasi([]);
      setPotensi('');
      setKompetitor('');
    }
    setPics(picRowsFromCustomer(editing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, customerEditId]);

  function addPicRow() {
    setPics((list) => [...list, { id: uid(), nama: '', jabatan: '', phone: '', email: '', isPrimary: list.length === 0, peran: '' }]);
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
    const payload = { name: trimmed, cabang, pics, address, catatan, segmen, aplikasi, potensi: potensi.replace(/\D/g, ''), kompetitor };
    try {
      const { customer } = customerEditId ? await api.put<{ customer: Customer }>(`/api/customers/${customerEditId}`, payload) : await api.post<{ customer: Customer }>('/api/customers', payload);
      upsertCustomer(customer);
      closeModal();
      useUiStore.setState({ customerFormReturnTo: null });
      openModal(returnTo);
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
        useUiStore.setState({ customerFormReturnTo: null });
        openModal(returnTo);
      }}
      title={customerEditId ? tr("Edit Customer") : tr("Tambah Customer")}
      onSubmit={onSubmit}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              closeModal();
              useUiStore.setState({ customerFormReturnTo: null });
              openModal(returnTo);
            }}
          >
            {tr("Batal")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {tr("Simpan Customer")}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="full">
          <label>{tr("Nama Customer *")}</label>
          <CustomerNameInput required mode="warn" ignore={editing?.name} value={name} onChange={setName} placeholder={tr("Nama customer")} />
        </div>
        <div>
          <label>{tr("Cabang")}</label>
          <input list="cabangList3" value={cabang} onChange={(e) => setCabang(e.target.value)} />
          <datalist id="cabangList3">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="full cf-profile">
          <div className="cf-profile-head">{tr("Profil customer")} <span>{tr("dipakai untuk status, skor & pembanding customer sejenis")}</span></div>
          <div className="form-grid">
            <div>
              <label>{tr("Industri / segmen")}</label>
              <select value={segmen} onChange={(e) => setSegmen(e.target.value)}>
                <option value="">{tr("— belum diisi —")}</option>
                {[...CUSTOMER_SEGMENTS, ...(segmen && !CUSTOMER_SEGMENTS.includes(segmen) ? [segmen] : [])].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
            <div>
              <label>{tr("Estimasi potensi pembelian / tahun (Rp)")}</label>
              <input type="text" inputMode="numeric" value={potensi} onChange={(e) => setPotensi(fmtPotensi(Number(e.target.value.replace(/\D/g, ''))))} placeholder={tr("cth. 5.000.000.000")} />
            </div>
            <div className="full">
              <label>{tr("Aplikasi pemakaian material")}</label>
              <div className="cf-chips">
                {CUSTOMER_APLIKASI.map((a) => {
                  const on = aplikasi.includes(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className={`cf-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setAplikasi((l) => (on ? l.filter((x) => x !== a.key) : [...l, a.key]))}
                    >
                      {on ? '✓ ' : ''}{a.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="full">
              <label>{tr("Kompetitor yang memasok saat ini")}</label>
              <input type="text" value={kompetitor} onChange={(e) => setKompetitor(e.target.value)} placeholder={tr("cth. distributor lokal, merek impor")} />
            </div>
          </div>
        </div>
        <div className="full" style={{ marginTop: 6 }}>
          <label>{tr("PIC / Kontak")}</label>
          {pics.map((p) => (
            <div className="rfq-item-card" key={p.id}>
              <div className="rfq-item-head">
                <span>{p.isPrimary ? tr("PIC Utama") : 'PIC'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!p.isPrimary && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => makePrimary(p.id)}>
                      {tr("Jadikan Utama")}
                    </button>
                  )}
                  <button type="button" className="icon-btn danger" disabled={pics.length <= 1} onClick={() => removePicRow(p.id)} title={tr("Hapus PIC")}>
                    <IconTrash />
                  </button>
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label>{tr("Nama")}</label>
                  <input type="text" value={p.nama} onChange={(e) => updatePicRow(p.id, { nama: e.target.value })} placeholder={tr("Nama penanggung jawab")} />
                </div>
                <div>
                  <label>{tr("Jabatan")}</label>
                  <input type="text" value={p.jabatan} onChange={(e) => updatePicRow(p.id, { jabatan: e.target.value })} placeholder={tr("cth. Purchasing Manager")} />
                </div>
                <div>
                  <label>{tr("No. Telp / WhatsApp")}</label>
                  <input type="text" value={p.phone} onChange={(e) => updatePicRow(p.id, { phone: e.target.value })} placeholder={tr("cth. 08123456789")} />
                </div>
                <div>
                  <label>{tr("Email")}</label>
                  <input type="text" value={p.email} onChange={(e) => updatePicRow(p.id, { email: e.target.value })} placeholder={tr("nama@perusahaan.com")} />
                </div>
                <div>
                  <label>{tr("Peran dalam pembelian")}</label>
                  <select value={p.peran} onChange={(e) => updatePicRow(p.id, { peran: e.target.value })}>
                    <option value="">{tr("— belum diisi —")}</option>
                    {PIC_PERAN.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={addPicRow}>
            <IconPlus /> {tr("Tambah PIC")}
          </button>
        </div>
        <div className="full">
          <label>{tr("Alamat")}</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tr("Alamat lengkap customer")} />
        </div>
        <div className="full">
          <label>{tr("Catatan")}</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr("Catatan tambahan (opsional)")} />
        </div>
      </div>
    </Modal>
  );
}
