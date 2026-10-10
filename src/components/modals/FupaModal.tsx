'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { AttachmentList } from '../AttachmentList';
import { ItemChat } from '../ItemChat';
import { IconDownload, IconMail, IconSave, IconWa } from '../icons';
import { MaterialSpecEditor } from '../MaterialSpecEditor';
import { emptyRow, itemToRow, materialRowsToItemRows, materialToRow, rowToItem, type SpecRow } from '@/lib/material-spec';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { formatFileSize, getProspectMaterials, normalizePhone, todayStr } from '@/lib/format';
import { buildPurchaseRequestMessage, downloadPurchaseRequestExcel } from '@/lib/purchase-request';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa, Rfq, RfqItem } from '@/lib/types';


export function FupaModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'fupa';
  const ctx = useUiStore((s) => s.fupaCtx);
  const closeModal = useUiStore((s) => s.closeModal);

  const rfqs = useDataStore((s) => s.rfqs);
  const prospects = useDataStore((s) => s.prospects);
  const purchasingContact = useDataStore((s) => s.purchasingContact);
  const currentUser = useDataStore((s) => s.currentUser);
  const fupas = useDataStore((s) => s.fupas);
  const upsertFupa = useDataStore((s) => s.upsertFupa);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const toast = useDataStore((s) => s.toast);

  const [fupaId, setFupaId] = useState<string | null>(null);
  const [noFupa, setNoFupa] = useState('');
  const [tglFupa, setTglFupa] = useState('');
  const [sourceNoRfq, setSourceNoRfq] = useState('');
  const [cabang, setCabang] = useState('');
  const [customer, setCustomer] = useState('');
  const [catatan, setCatatan] = useState('');
  // Edited as spec rows (bentuk, ukuran, …); `items` is what gets stored / sent.
  const [rows, setRows] = useState<SpecRow[]>([emptyRow()]);
  const items = useMemo<RfqItem[]>(() => rows.map(rowToItem), [rows]);
  const [busy, setBusy] = useState(false);
  /** Unread discussion at the moment the thread was opened, for the heading bubble. */
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!show || !ctx) return;
    setFupaId(ctx.fupaId);
    setChatUnread(0);

    if (ctx.fupaId) {
      const f = fupas.find((x) => x.id === ctx.fupaId);
      if (f) {
        setNoFupa(f.noFupa || '');
        setTglFupa(f.tglFupa || todayStr());
        setSourceNoRfq(f.sourceNoRfq || '');
        setCabang(f.cabang || '');
        setCustomer(f.customer || '');
        setCatatan(f.catatan || '');
        setRows(f.items?.length ? f.items.map(itemToRow) : [emptyRow()]);
      }
    } else {
      // Fresh FUP A. Three ways to get here, in order of how much detail they
      // carry: promoted from a specific RFQ; started from a Kanban card, where
      // we look for an RFQ already raised against that prospect (its lines
      // carry the Line/Grade/dimension detail Purchasing needs) and fall back
      // to the prospect's own materials; or opened cold from Kelola FUP A.
      const explicitRfq = ctx.sourceRfqId ? rfqs.find((r) => r.id === ctx.sourceRfqId) : null;
      const prospect = ctx.prospectId ? prospects.find((p) => p.id === ctx.prospectId) : null;
      const prospectRfq = !explicitRfq && prospect
        ? rfqs
            .filter((r) => r.prospectId === prospect.id && r.items?.length)
            .reduce<Rfq | null>((latest, cur) => (!latest || cur.createdAt > latest.createdAt ? cur : latest), null)
        : null;
      const src = explicitRfq ?? prospectRfq;

      setNoFupa('');
      setTglFupa(todayStr());
      setSourceNoRfq(src?.noRfq || '');
      setCabang(src?.cabang || prospect?.cabang || '');
      setCustomer(src?.customer || prospect?.customer || '');
      setCatatan('');
      if (src?.items?.length) {
        setRows(src.items.map(itemToRow));
      } else if (prospect) {
        setRows(materialRowsToItemRows(getProspectMaterials(prospect).map(materialToRow), prospect.tglPO || ''));
      } else {
        setRows([emptyRow()]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx?.fupaId, ctx?.sourceRfqId, ctx?.prospectId]);


  function docPayload() {
    return {
      no: noFupa,
      tgl: tglFupa,
      cabang,
      customer,
      requestedBy: currentUser?.name || '',
      items,
      catatan,
    };
  }

  const messageText = () => buildPurchaseRequestMessage('FUP A - PERMINTAAN PEMBELIAN', docPayload());

  async function sendWa() {
    if (!items.some((it) => (it.material || '').trim())) return toast('Isi minimal satu material permintaan pembelian', 'error');
    const phone = normalizePhone(purchasingContact.wa);
    if (phone.length < 9) return toast('Nomor WhatsApp Purchasing tidak valid. Isi dulu lewat modal RFQ.', 'error');
    await save(true);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(messageText())}`, '_blank');
  }

  async function sendEmail() {
    if (!items.some((it) => (it.material || '').trim())) return toast('Isi minimal satu material permintaan pembelian', 'error');
    if (!purchasingContact.email) return toast('Email Purchasing belum diisi. Isi dulu lewat modal RFQ.', 'error');
    await save(true);
    const subject = encodeURIComponent(`FUP A ${noFupa || ''} - ${cabang || ''} - ${customer || ''}`);
    const body = `${messageText()}\n\nMohon lampirkan file Excel FUP A hasil unduhan pada email ini sebelum dikirim.`;
    window.open(`mailto:${purchasingContact.email}?subject=${subject}&body=${encodeURIComponent(body)}`, '_blank');
  }

  async function exportExcel() {
    if (!items.some((it) => (it.material || '').trim())) return toast('Isi minimal satu material permintaan pembelian', 'error');
    try {
      await downloadPurchaseRequestExcel(
        'FUP A',
        'FUP A',
        docPayload(),
        `FUPA_${(noFupa || 'draft').replace(/[^a-zA-Z0-9]+/g, '_')}_${todayStr()}.xlsx`,
      );
      await save(false);
      toast('File Excel FUP A berhasil diunduh', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengexport FUP A', 'error');
    }
  }

  async function save(markSent: boolean, successMessage?: string): Promise<string | null> {
    if (!items.some((it) => (it.material || '').trim())) {
      toast('Isi minimal satu material permintaan pembelian', 'error');
      return null;
    }
    setBusy(true);
    try {
      const payload = { noFupa, tglFupa, sourceRfqId: ctx?.sourceRfqId ?? null, prospectId: ctx?.prospectId ?? null, sourceNoRfq, cabang, customer, catatan, items, markSent };
      const { fupa } = fupaId
        ? await api.put<{ fupa: Fupa }>(`/api/fupas/${fupaId}`, payload)
        : await api.post<{ fupa: Fupa }>('/api/fupas', payload);
      upsertFupa(fupa);
      setFupaId(fupa.id);
      // The source RFQ now carries a pointer to this FUP A.
      if (fupa.sourceRfqId) {
        const src = rfqs.find((r) => r.id === fupa.sourceRfqId);
        if (src && src.fupaId !== fupa.id) upsertRfq({ ...src, fupaId: fupa.id });
      }
      toast(successMessage ?? (markSent ? 'FUP A ditandai terkirim' : 'FUP A disimpan'), 'success');
      return fupa.id;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan FUP A', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Hands the FUP A to the internal Purchasing module. Same `markSent` write as
   * the WA/Email buttons — those additionally open an outgoing message to the
   * external Purchasing contact, this one stays inside the system.
   */
  async function sendToPurchasing() {
    await save(true, 'FUP A berhasil dikirim ke modul Purchasing');
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={fupaId ? 'Edit FUP A' : 'Buat FUP A (Permintaan Pembelian)'}
      wide2
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)}>
            <IconSave /> Simpan Draft
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={exportExcel}>
            <IconDownload /> Excel
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={sendEmail}>
            <IconMail /> Email
          </button>
          <button type="button" className="btn btn-wa" disabled={busy} onClick={sendWa}>
            <IconWa /> Kirim WhatsApp
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={sendToPurchasing}>
            Kirim ke Purchasing
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>No. FUP A</label>
          <input type="text" value={noFupa} onChange={(e) => setNoFupa(e.target.value)} placeholder="cth. FUPA/2026/001" />
        </div>
        <div>
          <label>Tanggal</label>
          <input type="date" value={tglFupa} onChange={(e) => setTglFupa(e.target.value)} />
        </div>
        <div>
          <label>No. RFQ Rujukan</label>
          <input type="text" value={sourceNoRfq} onChange={(e) => setSourceNoRfq(e.target.value)} placeholder="RFQ asal" />
        </div>
        <div>
          <label>Cabang</label>
          <input type="text" value={cabang} onChange={(e) => setCabang(e.target.value.toUpperCase())} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Customer (Cust)</label>
          <CustomerNameInput value={customer} onChange={setCustomer} />
        </div>
      </div>

      <div className="import-summary" style={{ marginTop: 0 }}>
        FUP A hanya dibuat untuk prospek yang sudah Won (PO/Kontrak atau DO). Pilih No. RFQ yang sudah dibuat
        sebelumnya saat prospek masih Aktif — data cabang, customer, dan material akan terisi otomatis.
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Daftar Material Permintaan Pembelian</label>
        <MaterialSpecEditor variant="doc" rows={rows} onChange={setRows} />
      </div>

      <div className="form-grid" style={{ marginTop: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
      </div>

      {(() => {
        const rec = fupaId ? fupas.find((f) => f.id === fupaId) : null;
        return rec?.purchJawaban ? (
          <div className="import-summary" style={{ marginTop: 16 }}>
            <b>Jawaban Purchasing:</b> {rec.purchJawaban}
          </div>
        ) : null;
      })()}
      <div className="import-summary">
        Nomor WhatsApp &amp; email Purchasing di atas otomatis diingat untuk dokumen berikutnya. Setelah export Excel,
        lampirkan filenya secara manual pada email sebelum dikirim.
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Lampiran File (maks. {formatFileSize(ATTACHMENT_MAX_BYTES)}/file)</label>
        <AttachmentList fupaId={fupaId} withProspect ensureParentId={() => save(false)} />
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Diskusi
          {chatUnread > 0 && <span className="item-chat-bubble">{chatUnread > 9 ? '9+' : chatUnread}</span>}
        </label>
        <ItemChat entity="fupa" entityId={fupaId} onUnreadAtOpen={setChatUnread} />
      </div>
    </Modal>
  );
}
