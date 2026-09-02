'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { ItemChat } from '../ItemChat';
import { IconPlus, IconTrash } from '../icons';
import { CABANG_LIST } from '@/lib/constants';
import { formatRupiah, getProspectMaterials, materialUnitPrice, num } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Material, Prospect } from '@/lib/types';

const emptyMaterial = (): Material => ({ line: '', uraian: '', qty: 1, beratPc: 0, hargaKg: 0, harga: 0 });

export function ProspectFormModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'prospectForm';
  const editId = useUiStore((s) => s.editProspectId);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const pendingQCD = useUiStore((s) => s.pendingProspectQCD);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const isSales = currentUser?.role === 'sales';
  const editing = editId ? records.find((r) => r.id === editId) || null : null;

  // Mirrors api-helpers.ts#prospectScopeLocks, which the write routes enforce —
  // this only saves the user from filling in a field that would be overridden.
  const locks =
    currentUser?.role === 'sales' ? { reg: true, cabang: true, se: true }
    : currentUser?.role === 'bm' ? { reg: true, cabang: true, se: false }
    : currentUser?.role === 'rm' ? { reg: true, cabang: false, se: false }
    : { reg: false, cabang: false, se: false };

  /**
   * Sales/BM accounts store a cabang but no reg, so their region is derived from
   * the cabang -> reg mapping in loaded prospects. An unseen branch leaves the
   * field open rather than locking it to a wrong guess.
   */
  const lockedReg = useMemo(() => {
    if (!locks.reg || !currentUser) return null;
    if (currentUser.reg != null) return String(currentUser.reg);
    const cab = (currentUser.cabang || '').trim().toUpperCase();
    if (!cab) return null;
    const match = records.find((r) => (r.cabang || '').trim().toUpperCase() === cab && r.reg != null);
    return match?.reg != null ? String(match.reg) : null;
  }, [locks.reg, currentUser, records]);

  const [reg, setReg] = useState('1');
  const [cabang, setCabang] = useState('');
  const [se, setSe] = useState('');
  const [status, setStatus] = useState('0');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [penawaranTerkirim, setPenawaranTerkirim] = useState(false);
  const [terfaktur, setTerfaktur] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([emptyMaterial()]);
  const [kondisiStock, setKondisiStock] = useState('');
  const [tglPenawaran, setTglPenawaran] = useState('');
  const [tglPO, setTglPO] = useState('');
  const [tglDelivery, setTglDelivery] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setReg(String(editing.reg ?? 1));
      setCabang(editing.cabang || '');
      setSe(editing.se || '');
      setStatus(String(num(editing.status)));
      setCustomer(editing.customer || '');
      setPhone(editing.phone || '');
      setPenawaranTerkirim(!!editing.penawaranTerkirim);
    setTerfaktur(!!editing.terfaktur);
      setMaterials(getProspectMaterials(editing));
      setKondisiStock(editing.kondisiStock || '');
      setTglPenawaran(editing.tglPenawaran || '');
      setTglPO(editing.tglPO || '');
      setTglDelivery(editing.tglDelivery || '');
      setKeterangan(editing.keterangan || '');
      useUiStore.setState({
        pendingProspectQCD: {
          quality: editing.qcdQuality || '',
          cost: editing.qcdCost || '',
          delivery: editing.qcdDelivery || '',
          kompetitor: editing.qcdKompetitor || '',
          catatan: editing.qcdCatatan || '',
        },
      });
    } else {
      setReg(lockedReg ?? '1');
      setCabang(locks.cabang ? currentUser?.cabang || '' : '');
      setSe(locks.se ? currentUser?.se || '' : '');
      setStatus('0');
      setCustomer('');
      setPhone('');
      setPenawaranTerkirim(false);
      setTerfaktur(false);
      setMaterials([emptyMaterial()]);
      setKondisiStock('');
      setTglPenawaran('');
      setTglPO('');
      setTglDelivery('');
      setKeterangan('');
      useUiStore.setState({ pendingProspectQCD: { quality: '', cost: '', delivery: '', kompetitor: '', catatan: '' } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, editId]);

  const cabangOptions = useMemo(() => Array.from(new Set([...CABANG_LIST, ...records.map((r) => r.cabang).filter(Boolean)])) as string[], [records]);

  const totals = useMemo(() => {
    const totalQty = materials.reduce((s, it) => s + num(it.qty), 0);
    const totalBerat = materials.reduce((s, it) => s + num(it.qty) * num(it.beratPc), 0);
    const totalValue = materials.reduce((s, it) => s + num(it.qty) * materialUnitPrice(it), 0);
    return { totalQty, totalBerat, totalValue };
  }, [materials]);

  function updateMaterial(idx: number, patch: Partial<Material>) {
    setMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }
  function removeMaterial(idx: number) {
    setMaterials((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function onCustomerChange(val: string) {
    setCustomer(val);
    if (!phone) {
      const match = customers.find((c) => (c.name || '').trim().toLowerCase() === val.trim().toLowerCase());
      if (match?.phone) setPhone(match.phone);
    }
  }

  function onStatusChange(val: string) {
    setStatus(val);
    const n = Number(val);
    if (n === 4 || n === 6) {
      useUiStore.setState({ qcdCtx: { mode: 'prospectForm', statusVal: n, recordId: editId } });
      openModal('qcd');
    }
  }

  async function onSubmit() {
    const trimmedCustomer = customer.trim();
    if (!trimmedCustomer) {
      toast('Nama customer wajib diisi', 'error');
      return;
    }
    if (!materials.some((m) => (m.uraian || '').trim())) {
      toast('Isi minimal satu uraian material', 'error');
      return;
    }
    setBusy(true);
    const payload = {
      reg: Number(reg),
      cabang,
      se,
      customer: trimmedCustomer,
      phone,
      tglPenawaran: tglPenawaran || '',
      tglPO: tglPO || '',
      tglDelivery: tglDelivery || '',
      materials,
      kondisiStock,
      keterangan,
      status: Number(status),
      penawaranTerkirim,
      terfaktur,
      qcdQuality: pendingQCD.quality,
      qcdCost: pendingQCD.cost,
      qcdDelivery: pendingQCD.delivery,
      qcdKompetitor: pendingQCD.kompetitor,
      qcdCatatan: pendingQCD.catatan,
    };
    try {
      const { prospect } = editId
        ? await api.put<{ prospect: Prospect }>(`/api/prospects/${editId}`, payload)
        : await api.post<{ prospect: Prospect }>('/api/prospects', payload);
      upsertProspect(prospect);
      closeModal();
      toast(editId ? 'Perubahan prospek disimpan' : 'Prospek baru ditambahkan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan prospek', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show} wide2
      onClose={closeModal}
      title={editId ? 'Edit Prospek' : 'Tambah Prospek Baru'}
      onSubmit={onSubmit}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Simpan Prospek
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>Regional</label>
          <select value={reg} disabled={locks.reg} onChange={(e) => setReg(e.target.value)}>
            <option value="1">Regional 1</option>
            <option value="2">Regional 2</option>
            <option value="3">Regional 3</option>
          </select>
          {locks.reg && <div className="field-note">Terkunci sesuai akun Anda</div>}
        </div>
        <div>
          <label>Cabang</label>
          <input list="cabangList" value={cabang} readOnly={locks.cabang} onChange={(e) => setCabang(e.target.value)} placeholder="cth. DKI" />
          <datalist id="cabangList">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {locks.cabang && <div className="field-note">Terkunci sesuai akun Anda</div>}
        </div>
        <div>
          <label>Sales Engineer (SE)</label>
          <input type="text" value={se} readOnly={locks.se} onChange={(e) => setSe(e.target.value)} placeholder="Inisial SE" />
          {locks.se && <div className="field-note">Terkunci sesuai akun Anda</div>}
        </div>
        <div>
          <label>Status Pipeline</label>
          <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
            <option value="0">Sales Activity</option>
            <option value="1">1 · Permintaan</option>
            <option value="2">2 · Penawaran Harga</option>
            <option value="3">3 · Negosiasi</option>
            <option value="4">4 · PO / Kontrak</option>
            <option value="5">5 · DO</option>
            <option value="6">6 · Lose Order / Batal</option>
          </select>
        </div>
        <div className="full">
          <label>Customer *</label>
          <input list="customerNameList" type="text" required value={customer} onChange={(e) => onCustomerChange(e.target.value)} placeholder="Nama customer" />
          <datalist id="customerNameList">
            {customers.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
        <div className="full">
          <label>No. WhatsApp / HP Customer</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="cth. 08123456789" />
        </div>
        <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={penawaranTerkirim} onChange={(e) => setPenawaranTerkirim(e.target.checked)} id="f_penawaranTerkirim" />
          <label htmlFor="f_penawaranTerkirim" style={{ margin: 0, textTransform: 'none', fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
            Penawaran sudah terkirim ke customer <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>(kosongkan jika masih Pending / belum dikirim)</span>
          </label>
        </div>
        {Number(status) === 5 && (
          <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={terfaktur} onChange={(e) => setTerfaktur(e.target.checked)} id="f_terfaktur" />
            <label htmlFor="f_terfaktur" style={{ margin: 0, textTransform: 'none', fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
              Sudah terfaktur (invoice) <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>(centang = masuk Omzet, kosongkan = masih GIT/barang jalan)</span>
            </label>
          </div>
        )}
        <div className="full">
          <label>Daftar Material</label>
          <div className="qitem-header">
            <span>Line</span>
            <span>Uraian Material</span>
            <span>Qty</span>
            <span>Berat/pc (Kg)</span>
            <span>Harga/Kg</span>
            <span>Total</span>
            <span></span>
          </div>
          {materials.map((it, idx) => (
            <div className="qitem-row" key={idx}>
              <input type="text" placeholder="Line" value={it.line} onChange={(e) => updateMaterial(idx, { line: e.target.value })} />
              <input type="text" placeholder="Uraian material" value={it.uraian} onChange={(e) => updateMaterial(idx, { uraian: e.target.value })} />
              <input type="number" min={0} step="any" value={it.qty} onChange={(e) => updateMaterial(idx, { qty: num(e.target.value) })} />
              <input type="number" min={0} step="any" placeholder="Kg/pc" value={it.beratPc || ''} onChange={(e) => updateMaterial(idx, { beratPc: num(e.target.value) })} />
              <input type="number" min={0} step="any" placeholder="Rp/Kg" value={it.hargaKg || ''} onChange={(e) => updateMaterial(idx, { hargaKg: num(e.target.value) })} />
              <div className="qi-total mono">{formatRupiah(num(it.qty) * materialUnitPrice(it))}</div>
              <button type="button" className="icon-btn danger qi-remove" disabled={materials.length <= 1} onClick={() => removeMaterial(idx)} title="Hapus material">
                <IconTrash />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => setMaterials((prev) => [...prev, emptyMaterial()])}>
            <IconPlus /> Tambah Material
          </button>
        </div>
        <div>
          <label>Total Qty (Pcs)</label>
          <input type="text" readOnly value={totals.totalQty} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>Total Berat (Kg)</label>
          <input type="text" readOnly value={`${totals.totalBerat.toLocaleString('id-ID')} Kg`} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>Total Value (Rp)</label>
          <input type="text" readOnly value={formatRupiah(totals.totalValue)} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>Kondisi Stock</label>
          <input type="text" value={kondisiStock} onChange={(e) => setKondisiStock(e.target.value)} placeholder="cth. Ready / Indent" />
        </div>
        <div>
          <label>Tgl. Penawaran</label>
          <input type="date" value={tglPenawaran} onChange={(e) => setTglPenawaran(e.target.value)} />
        </div>
        <div>
          <label>Tgl. PO</label>
          <input type="date" value={tglPO} onChange={(e) => setTglPO(e.target.value)} />
        </div>
        <div>
          <label>Tgl. Delivery</label>
          <input type="date" value={tglDelivery} onChange={(e) => setTglDelivery(e.target.value)} />
        </div>
        <div className="full">
          <label>Keterangan</label>
          <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Catatan / progres terbaru" />
        </div>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Diskusi</label>
        <ItemChat entity="prospect" entityId={editId} />
      </div>
    </Modal>
  );
}
