'use client';

import { promptItemFlow } from '@/lib/item-flow-prompt';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { ItemChat } from '../ItemChat';
import { AttachmentList } from '../AttachmentList';
import { ProspectIssueSection } from '../issues/ProspectIssueSection';
import { MaterialSpecEditor } from '../MaterialSpecEditor';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
import { formatFileSize, formatRupiah, getProspectMaterials, materialUnitPrice, num } from '@/lib/format';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { emptyRow, isFabRow, materialToRow, rowToMaterial, type SpecRow } from '@/lib/material-spec';
import { isStokKond, legacyStok, stockSummary } from '@/lib/item-stock';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { EMPTY_QCD, useUiStore } from '@/store/useUiStore';
import { useCan } from '@/hooks/useCan';
import { qcdMissing, qcdRequiredOnMove } from '@/lib/qcd';
import { QcdFields } from '../QcdFields';
import { useRoster } from '../issues/shared';
import { loseDateProblem } from '@/lib/lose-date';
import type { Prospect } from '@/lib/types';
import { canSetFaktur } from '@/lib/roles';

import { FollowUpFields } from '../FollowUpMoveModal';
import { followUpDateProblem, followUpRequiredOnMove, jakartaDate } from '@/lib/followup-rule';
import { useT } from '@/store/useLangStore';
export function ProspectFormModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'prospectForm';
  // Kelola Role: tanpa hak Tambah/Ubah, form dibuka hanya-baca.
  const readOnly = !useCan('prospek', 'e');
  const editId = useUiStore((s) => s.editProspectId);
  const closeModalRaw = useUiStore((s) => s.closeModal);
  const quoteFlag = useUiStore((s) => s.prospectFormQuote);
  const closeModal = () => {
    useUiStore.setState({ prospectFormQuote: false });
    closeModalRaw();
  };
  const openModal = useUiStore((s) => s.openModal);
  const pendingQCD = useUiStore((s) => s.pendingProspectQCD);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const isSales = currentUser?.role === 'sales';
  const editing = editId ? records.find((r) => r.id === editId) || null : null;
  // "Buat Penawaran": prospek baru langsung di tahap Penawaran Harga; setelah disimpan surat penawaran terbuka.
  const quoteMode = !editId && quoteFlag;

  // Mirrors api-helpers.ts#prospectScopeLocks, which the write routes enforce —
  // this only saves the user from filling in a field that would be overridden.
  const locks =
    currentUser?.role === 'sales' ? { reg: true, cabang: true, se: true }
    : currentUser?.role === 'bm' || currentUser?.role === 'salesadmin' ? { reg: true, cabang: true, se: false }
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
  const [tglFaktur, setTglFaktur] = useState('');
  const [noFaktur, setNoFaktur] = useState('');
  const fakturEditable = canSetFaktur(currentUser?.role);
  // Edited as spec rows (bentuk, ukuran, …); converted back to Material on save.
  const [rows, setRows] = useState<SpecRow[]>([emptyRow()]);
  const materials = useMemo(() => rows.map(rowToMaterial), [rows]);
  const hasFab = rows.some(isFabRow);
  const [kondisiStock, setKondisiStock] = useState('');
  const [tglPenawaran, setTglPenawaran] = useState('');
  const [noPo, setNoPo] = useState('');
  const [tglPO, setTglPO] = useState('');
  const [tglDelivery, setTglDelivery] = useState('');
  const [tglLose, setTglLose] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [busy, setBusy] = useState(false);
  // Jadwal follow-up — wajib saat status dipindah ke tahap pipeline aktif.
  const [fuDate, setFuDate] = useState('');
  const [fuNote, setFuNote] = useState('');
  const [fuErr, setFuErr] = useState(false);

  useEffect(() => {
    if (!show) return;
    setFuNote('');
    setFuErr(false);
    setFuDate(editing?.followUpAt && editing.followUpAt >= jakartaDate() ? editing.followUpAt : '');
    if (editing) {
      setReg(String(editing.reg ?? 1));
      setCabang(editing.cabang || '');
      setSe(editing.se || '');
      setStatus(String(num(editing.status)));
      setCustomer(editing.customer || '');
      setPhone(editing.phone || '');
      setPenawaranTerkirim(!!editing.penawaranTerkirim);
    setTerfaktur(!!editing.terfaktur);
      setTglFaktur(editing.tglFaktur || '');
      setNoFaktur(editing.noFaktur || '');
      // Prospek lama: teks "Kondisi Stock" dipetakan ke semua item yang belum punya kondisi.
      const legacy = legacyStok(editing.kondisiStock);
      setRows(
        getProspectMaterials(editing)
          .map(materialToRow)
          .map((r) => (r.stok || !legacy ? r : { ...r, stok: legacy.kond, stokLama: legacy.lama })),
      );
      setKondisiStock(editing.kondisiStock || '');
      setTglPenawaran(editing.tglPenawaran || '');
      setNoPo(editing.noPo || '');
      setTglPO(editing.tglPO || '');
      setTglDelivery(editing.tglDelivery || '');
      setTglLose(editing.tglLose || '');
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
      // Default: kode SE akun yang login (Sales selalu; BM / lainnya bila punya kode SE).
      setSe((currentUser?.se || '').trim().toUpperCase());
      setStatus(quoteFlag ? '2' : '0');
      setCustomer('');
      setPhone('');
      setPenawaranTerkirim(false);
      setTerfaktur(false);
      setTglFaktur('');
      setNoFaktur('');
      setRows([emptyRow()]);
      setKondisiStock('');
      setTglPenawaran('');
      setNoPo('');
      setTglPO('');
      setTglDelivery('');
      setTglLose('');
      setKeterangan('');
      useUiStore.setState({ pendingProspectQCD: { ...EMPTY_QCD } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, editId]);

  // Daftar Sales (akun dengan kode SE) untuk dropdown; disaring ke cabang yang dipilih.
  const roster = useRoster();
  const seOptions = useMemo(() => {
    const cab = cabang.trim().toUpperCase();
    const list = roster
      .filter((u) => (u.se || '').trim() && ['sales', 'bm', 'rm', 'gm'].includes(u.role))
      .filter((u) => !cab || (u.cabang || '').trim().toUpperCase() === cab)
      .map((u) => ({ se: (u.se || '').trim().toUpperCase(), label: `${u.name} (${(u.se || '').trim().toUpperCase()})${cab ? '' : u.cabang ? ` · ${u.cabang}` : ''}` }));
    const seen = new Set<string>();
    const uniq = list.filter((o) => (seen.has(o.se) ? false : (seen.add(o.se), true))).sort((a, b) => a.label.localeCompare(b.label));
    // Kode SE lama yang tidak (lagi) punya akun di cabang ini tetap bisa dipertahankan.
    const cur = se.trim().toUpperCase();
    if (cur && !seen.has(cur)) {
      const other = roster.find((u) => (u.se || '').trim().toUpperCase() === cur);
      uniq.unshift({ se: cur, label: other ? `${other.name} (${cur}) · ${other.cabang || '-'}` : `${cur} ${tr('(tanpa akun)')}` });
    }
    return uniq;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, cabang, se]);

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
  const fuNeeded = followUpRequiredOnMove(editing ? num(editing.status) : null, Number(status));

  // QCD fields appear inline below for a closed status (PO/DO/Lose).
  // Previously a separate modal replaced this form and its unsaved edits were
  // lost when that modal closed. Mandatory on a closing move (lib/qcd.ts).
  function onStatusChange(val: string) {
    setStatus(val);
  }


  async function onSubmit() {
    if (readOnly) return;
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
    if (Number(status) === 6) {
      const ld = tglLose || jakartaDate();
      const loseErr = ld !== editing?.tglLose ? loseDateProblem(ld, tglPenawaran) : null;
      if (loseErr) return toast(loseErr, 'error');
    }
    if (fuNeeded && followUpDateProblem(fuDate)) {
      setFuErr(true);
      toast(followUpDateProblem(fuDate)!, 'error');
      return;
    }
    if (quoteMode && !se.trim()) {
      toast('Pilih Sales yang menangani penawaran ini', 'error');
      return;
    }
    setBusy(true);
    const payload = {
      ...(fuNeeded ? { followUpAt: fuDate, followUpNote: fuNote.trim() } : {}),
      reg: Number(reg),
      cabang,
      se,
      customer: trimmedCustomer,
      phone,
      tglPenawaran: tglPenawaran || '',
      noPo: noPo.trim(),
      tglPO: tglPO || '',
      tglDelivery: tglDelivery || '',
      ...(Number(status) === 6 ? { tglLose: tglLose || jakartaDate() } : {}),
      materials,
      // Ringkasan dari kondisi per item; teks lama dipakai bila belum ada yang diisi per item.
      kondisiStock: stockSummary(rows.map((r) => (isStokKond(r.stok) ? r.stok : null))) || kondisiStock,
      keterangan,
      status: Number(status),
      penawaranTerkirim,
      terfaktur,
      tglFaktur: terfaktur ? tglFaktur : '',
      noFaktur: terfaktur ? noFaktur : '',
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
      if (quoteMode) {
        // Lanjut langsung ke Surat Penawaran prospek yang baru dibuat.
        useUiStore.setState({ prospectFormQuote: false, quotationProspectId: prospect.id, modal: 'quotation' });
        toast('Prospek dibuat di tahap Penawaran Harga — lengkapi surat penawarannya', 'success');
        return;
      }
      closeModal();
      toast(editId ? 'Perubahan prospek disimpan' : 'Prospek baru ditambahkan', 'success');
      promptItemFlow(prevStatus, prospect);
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
      title={readOnly ? tr("Lihat Prospek") : editId ? tr("Edit Prospek") : quoteMode ? tr("Buat Penawaran Baru") : tr("Tambah Prospek Baru")}
      onSubmit={onSubmit}
      footer={
        <>
          {readOnly && <span className="field-note" style={{ margin: '0 auto 0 0' }}>{tr("Hanya-baca — role Anda tidak memiliki hak mengubah prospek.")}</span>}
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {readOnly ? tr("Tutup") : tr("Batal")}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {quoteMode ? tr("Simpan & Buat Surat Penawaran") : tr("Simpan Prospek")}
            </button>
          )}
        </>
      }
    >
      {quoteMode && (
        <div className="import-summary" style={{ marginTop: 0, marginBottom: 12 }}>
          {tr("Isi customer, Sales yang menangani, dan material. Setelah disimpan, prospek masuk tahap")} <b>{tr("Penawaran Harga")}</b> {tr("dan Surat Penawaran langsung terbuka (atas nama Sales tersebut).")}
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid">
        <div>
          <label>{tr("Regional")}</label>
          <select value={reg} disabled={locks.reg} onChange={(e) => setReg(e.target.value)}>
            <option value="1">{tr("Regional 1")}</option>
            <option value="2">{tr("Regional 2")}</option>
            <option value="3">{tr("Regional 3")}</option>
          </select>
          {locks.reg && <div className="field-note">{tr("Terkunci sesuai akun Anda")}</div>}
        </div>
        <div>
          <label>{tr("Cabang")}</label>
          <input type="text" list="cabangList" value={cabang} readOnly={locks.cabang} onChange={(e) => setCabang(e.target.value)} placeholder={tr("cth. DKI")} />
          <datalist id="cabangList">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {locks.cabang && <div className="field-note">{tr("Terkunci sesuai akun Anda")}</div>}
        </div>
        <div>
          <label>{tr("Sales Engineer (SE)")}{quoteMode && <span style={{ color: 'var(--rust-500)' }}> *</span>}</label>
          <select value={se.trim().toUpperCase()} disabled={locks.se} onChange={(e) => setSe(e.target.value)}>
            <option value="">{tr("— pilih Sales —")}</option>
            {seOptions.map((o) => (
              <option key={o.se} value={o.se}>
                {o.label}
              </option>
            ))}
          </select>
          {locks.se && <div className="field-note">{tr("Terkunci sesuai akun Anda")}</div>}
        </div>
        <div>
          <label>{tr("Status Pipeline")}</label>
          <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
            <option value="0">{tr("Sales Activity")}</option>
            <option value="1">{tr("1 · Permintaan")}</option>
            <option value="2">{tr("2 · Penawaran Harga")}</option>
            <option value="3">{tr("3 · Negosiasi")}</option>
            <option value="4">{tr("4 · PO / Kontrak")}</option>
            <option value="5">{tr("5 · DO")}</option>
            <option value="6">{tr("6 · Lose Order / Batal")}</option>
          </select>
        </div>
        {fuNeeded && !readOnly && (
          <div className="fu-inline">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>
              {tr('Pindah ke {tahap} — jadwalkan follow-up', { tahap: STATUS_META[Number(status)]?.label ?? status })}
            </div>
            <FollowUpFields date={fuDate} note={fuNote} onDate={setFuDate} onNote={setFuNote} showErr={fuErr} />
          </div>
        )}
        <div className="full">
          <label>{tr("Customer *")}</label>
          <CustomerNameInput required value={customer} onChange={onCustomerChange} placeholder={tr("Nama customer")} />
          <div className="field-note">{tr("Customer baru otomatis tercatat di Kelola Customer.")}</div>
        </div>
        <div className="full">
          <label>{tr("No. WhatsApp / HP Customer")}</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tr("cth. 08123456789")} />
        </div>
        <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={penawaranTerkirim} onChange={(e) => setPenawaranTerkirim(e.target.checked)} id="f_penawaranTerkirim" />
          <label htmlFor="f_penawaranTerkirim" style={{ margin: 0, textTransform: 'none', fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
            {tr("Penawaran sudah terkirim ke customer")} <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>{tr("(kosongkan jika masih Pending / belum dikirim)")}</span>
          </label>
        </div>
        {Number(status) === 5 && (
          <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={terfaktur} disabled={!fakturEditable} onChange={(e) => setTerfaktur(e.target.checked)} id="f_terfaktur" />
            <label htmlFor="f_terfaktur" style={{ margin: 0, textTransform: 'none', fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
              {tr("Sudah terfaktur (invoice)")} <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>{fakturEditable ? tr("(centang = masuk Omzet, kosongkan = masih GIT/barang jalan)") : tr("(diisi oleh Admin Sales / BM)")}</span>
            </label>
          </div>
        )}
        {Number(status) === 5 && terfaktur && (
          <>
            <div>
              <label>{tr("Tgl. Faktur")}</label>
              <input type="date" value={tglFaktur} onChange={(e) => setTglFaktur(e.target.value)} disabled={!fakturEditable} />
            </div>
            <div>
              <label>{tr("No. Faktur")}</label>
              <input type="text" value={noFaktur} onChange={(e) => setNoFaktur(e.target.value)} disabled={!fakturEditable} placeholder={tr("cth. INV/DKI/2026/10/0123")} />
            </div>
          </>
        )}
        <div className="full">
          <label>{tr("Daftar Material")}</label>
          <MaterialSpecEditor variant="prospek" rows={rows} onChange={setRows} hideSummary />
          {hasFab && (
            <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid #EEDFC8', borderRadius: 8, background: '#FFFBF4' }}>
              <label style={{ display: 'block', marginBottom: 6 }}>{tr("Gambar kerja Line 05 (maks.")} {formatFileSize(ATTACHMENT_MAX_BYTES)}{tr("/file)")}</label>
              {editId ? (
                <AttachmentList prospectId={editId} />
              ) : (
                <div className="field-note" style={{ margin: 0 }}>{tr("Simpan prospek dulu, lalu buka Edit Prospek untuk melampirkan gambar.")}</div>
              )}
            </div>
          )}
        </div>
        <div>
          <label>{tr("Total Qty (Pcs)")}</label>
          <input type="text" readOnly value={totals.totalQty} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>{tr("Total Berat (Kg)")}</label>
          <input type="text" readOnly value={`${totals.totalBerat.toLocaleString('id-ID')} Kg`} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>{tr("Total Value (Rp)")}</label>
          <input type="text" readOnly value={formatRupiah(totals.totalValue)} style={{ background: 'var(--steel-100)', fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600 }} />
        </div>
        <div>
          <label>{tr("Kondisi Stock")}</label>
          <input
            type="text"
            readOnly
            value={stockSummary(rows.map((r) => (isStokKond(r.stok) ? r.stok : null))) || kondisiStock || '-'}
            title={tr("Diisi per item di Daftar Material")}
            style={{ background: 'var(--steel-100)' }}
          />
        </div>
        <div>
          <label>{tr("Tgl. Penawaran")}</label>
          <input type="date" value={tglPenawaran} onChange={(e) => setTglPenawaran(e.target.value)} />
        </div>
        <div>
          <label>
            {tr("No. PO")}{(Number(status) === 4 || Number(status) === 5) && <span style={{ color: 'var(--rust-500)' }}> *</span>}
          </label>
          <input type="text" value={noPo} onChange={(e) => setNoPo(e.target.value)} placeholder={tr("cth. PO-2026-00123")} />
          {(Number(status) === 4 || Number(status) === 5) && !noPo.trim() && (
            <div className="field-note">{tr("Wajib diisi untuk status PO/Kontrak atau DO")}</div>
          )}
        </div>
        <div>
          <label>{tr("Tgl. PO")}</label>
          <input type="date" value={tglPO} onChange={(e) => setTglPO(e.target.value)} />
        </div>
        <div>
          <label>{tr("Tgl. Delivery")}</label>
          <input type="date" value={tglDelivery} onChange={(e) => setTglDelivery(e.target.value)} />
        </div>
        {Number(status) === 6 && (
          <div>
            <label>
              {tr("Tgl. Lose Order")} <span style={{ color: 'var(--rust-500)' }}>*</span>
            </label>
            <input type="date" value={tglLose || jakartaDate()} max={jakartaDate()} onChange={(e) => setTglLose(e.target.value)} />
            <div className="field-note">{tr("Tanggal customer memutuskan tidak order — dipakai laporan Lose per bulan.")}</div>
          </div>
        )}
        <div className="full">
          <label>{tr("Keterangan")}</label>
          <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder={tr("Catatan / progres terbaru")} />
        </div>
        {[4, 5, 6].includes(Number(status)) && (
          <div className="full rfq-item-card" style={{ borderColor: qcdNeeded ? 'var(--amber-600)' : undefined }}>
            <div className="rfq-item-head">
              <span>{tr("Quality · Cost · Delivery")} {qcdNeeded ? tr("(wajib — deal ditutup)") : ''}</span>
            </div>
            <QcdFields value={pendingQCD} onChange={(v) => useUiStore.setState({ pendingProspectQCD: v })} statusVal={Number(status)} required={qcdNeeded} />
          </div>
        )}
      </div>
      </fieldset>
      {editing && <ProspectIssueSection prospect={editing} />}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>{tr("Diskusi")}</label>
        <ItemChat entity="prospect" entityId={editId} />
      </div>
    </Modal>
  );
}
