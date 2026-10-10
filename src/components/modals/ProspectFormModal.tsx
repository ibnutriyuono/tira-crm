'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { ItemChat } from '../ItemChat';
import { AttachmentList } from '../AttachmentList';
import { MaterialSpecEditor } from '../MaterialSpecEditor';
import { CABANG_LIST } from '@/lib/constants';
import { formatFileSize, formatRupiah, getProspectMaterials, materialUnitPrice, num } from '@/lib/format';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { emptyRow, isFabRow, materialToRow, rowToMaterial, type SpecRow } from '@/lib/material-spec';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { EMPTY_QCD, useUiStore } from '@/store/useUiStore';
import { qcdMissing, qcdRequiredOnMove } from '@/lib/qcd';
import { QcdFields } from '../QcdFields';
import type { Prospect } from '@/lib/types';

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
  // Edited as spec rows (bentuk, ukuran, …); converted back to Material on save.
  const [rows, setRows] = useState<SpecRow[]>([emptyRow()]);
  const materials = useMemo(() => rows.map(rowToMaterial), [rows]);
  const hasFab = rows.some(isFabRow);
  const [kondisiStock, setKondisiStock] = useState('');
  const [tglPenawaran, setTglPenawaran] = useState('');
  const [noPo, setNoPo] = useState('');
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
      setRows(getProspectMaterials(editing).map(materialToRow));
      setKondisiStock(editing.kondisiStock || '');
      setTglPenawaran(editing.tglPenawaran || '');
      setNoPo(editing.noPo || '');
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
          qualityLevel: editing.qcdQualityLevel || '',
          costLevel: editing.qcdCostLevel || '',
          deliveryLevel: editing.qcdDeliveryLevel || '',
          faktor: editing.qcdFaktor || '',
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
      setRows([emptyRow()]);
      setKondisiStock('');
      setTglPenawaran('');
      setNoPo('');
      setTglPO('');
      setTglDelivery('');
      setKeterangan('');
      useUiStore.setState({ pendingProspectQCD: { ...EMPTY_QCD } });
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


  function onCustomerChange(val: string) {
    setCustomer(val);
    if (!phone) {
      const match = customers.find((c) => (c.name || '').trim().toLowerCase() === val.trim().toLowerCase());
      if (match?.phone) setPhone(match.phone);
    }
  }

  const qcdNeeded = qcdRequiredOnMove(editing ? num(editing.status) : null, Number(status));

  // QCD fields appear inline below for a closed status (PO/DO/Lose).
  // Previously a separate modal replaced this form and its unsaved edits were
  // lost when that modal closed. Mandatory on a closing move (lib/qcd.ts).
  function onStatusChange(val: string) {
    setStatus(val);
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
    const statusNum = Number(status);
    // Wajib begitu status benar-benar BERPINDAH ke PO/Kontrak atau DO — bukan
    // setiap kali menyimpan prospek lama yang sudah lama duduk di status itu
    // tanpa No. PO tercatat (field ini baru ada sekarang, jadi data lama wajar
    // belum punya). DO ikut disyaratkan karena selalu didahului PO, termasuk
    // saat status dilompat langsung tanpa pernah "mampir" di status 4.
    const prevStatus = editing ? num(editing.status) : null;
    const isMovingToPo = (statusNum === 4 || statusNum === 5) && prevStatus !== statusNum;
    if (isMovingToPo && !noPo.trim()) {
      toast('No. PO wajib diisi saat memindahkan status ke PO/Kontrak atau DO', 'error');
      return;
    }
    if (qcdRequiredOnMove(prevStatus, statusNum)) {
      const miss = qcdMissing(statusNum, {
        qcdQualityLevel: pendingQCD.qualityLevel,
        qcdCostLevel: pendingQCD.costLevel,
        qcdDeliveryLevel: pendingQCD.deliveryLevel,
        qcdFaktor: pendingQCD.faktor,
        qcdKompetitor: pendingQCD.kompetitor,
      });
      if (miss) {
        toast(`${miss} Lengkapi di bagian QCD pada form ini.`, 'error');
        return;
      }
    }
    setBusy(true);
    const payload = {
      reg: Number(reg),
      cabang,
      se,
      customer: trimmedCustomer,
      phone,
      tglPenawaran: tglPenawaran || '',
      noPo: noPo.trim(),
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
      qcdQualityLevel: pendingQCD.qualityLevel,
      qcdCostLevel: pendingQCD.costLevel,
      qcdDeliveryLevel: pendingQCD.deliveryLevel,
      qcdFaktor: pendingQCD.faktor,
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
          <CustomerNameInput required value={customer} onChange={onCustomerChange} placeholder="Nama customer" />
          <div className="field-note">Customer baru otomatis tercatat di Kelola Customer.</div>
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
          <MaterialSpecEditor variant="prospek" rows={rows} onChange={setRows} hideSummary />
          {hasFab && (
            <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid #EEDFC8', borderRadius: 8, background: '#FFFBF4' }}>
              <label style={{ display: 'block', marginBottom: 6 }}>Gambar kerja Line 05 (maks. {formatFileSize(ATTACHMENT_MAX_BYTES)}/file)</label>
              {editId ? (
                <AttachmentList prospectId={editId} />
              ) : (
                <div className="field-note" style={{ margin: 0 }}>Simpan prospek dulu, lalu buka Edit Prospek untuk melampirkan gambar.</div>
              )}
            </div>
          )}
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
          <label>
            No. PO{(Number(status) === 4 || Number(status) === 5) && <span style={{ color: 'var(--rust-500)' }}> *</span>}
          </label>
          <input type="text" value={noPo} onChange={(e) => setNoPo(e.target.value)} placeholder="cth. PO-2026-00123" />
          {(Number(status) === 4 || Number(status) === 5) && !noPo.trim() && (
            <div className="field-note">Wajib diisi untuk status PO/Kontrak atau DO</div>
          )}
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
        {[4, 5, 6].includes(Number(status)) && (
          <div className="full rfq-item-card" style={{ borderColor: qcdNeeded ? 'var(--amber-600)' : undefined }}>
            <div className="rfq-item-head">
              <span>Quality · Cost · Delivery {qcdNeeded ? '(wajib — deal ditutup)' : ''}</span>
            </div>
            <QcdFields value={pendingQCD} onChange={(v) => useUiStore.setState({ pendingProspectQCD: v })} statusVal={Number(status)} required={qcdNeeded} />
          </div>
        )}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Diskusi</label>
        <ItemChat entity="prospect" entityId={editId} />
      </div>
    </Modal>
  );
}
