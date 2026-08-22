'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { AttachmentList } from '../AttachmentList';
import { ItemChat } from '../ItemChat';
import { IconDownload, IconMail, IconPlus, IconSave, IconTrash, IconWa } from '../icons';
import { RFQ_LOKAL_OPTIONS } from '@/lib/constants';
import { normalizePhone, todayStr } from '@/lib/format';
import { buildPurchaseRequestMessage, downloadPurchaseRequestExcel } from '@/lib/purchase-request';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa, RfqItem } from '@/lib/types';

const emptyItem = (): RfqItem => ({ line: '', grade: '', material: '', dia: '', thick: '', width: '', length: '', pcs: 1, berat: '', lokal: 'LOKAL ATAU IMPORT', estimasi: '' });

export function FupaModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'fupa';
  const ctx = useUiStore((s) => s.fupaCtx);
  const closeModal = useUiStore((s) => s.closeModal);

  const rfqs = useDataStore((s) => s.rfqs);
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
  const [items, setItems] = useState<RfqItem[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show || !ctx) return;
    setFupaId(ctx.fupaId);

    if (ctx.fupaId) {
      const f = fupas.find((x) => x.id === ctx.fupaId);
      if (f) {
        setNoFupa(f.noFupa || '');
        setTglFupa(f.tglFupa || todayStr());
        setSourceNoRfq(f.sourceNoRfq || '');
        setCabang(f.cabang || '');
        setCustomer(f.customer || '');
        setCatatan(f.catatan || '');
        setItems(f.items?.length ? f.items.map((it) => ({ ...it })) : [emptyItem()]);
      }
    } else {
      // Fresh FUP A promoted from a won RFQ — carry its header and lines over.
      const src = ctx.sourceRfqId ? rfqs.find((r) => r.id === ctx.sourceRfqId) : null;
      setNoFupa('');
      setTglFupa(todayStr());
      setSourceNoRfq(src?.noRfq || '');
      setCabang(src?.cabang || '');
      setCustomer(src?.customer || '');
      setCatatan('');
      setItems(src?.items?.length ? src.items.map((it) => ({ ...it })) : [emptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx?.fupaId, ctx?.sourceRfqId]);

  function setItem(idx: number, patch: Partial<RfqItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

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

  async function save(markSent: boolean) {
    if (!items.some((it) => (it.material || '').trim())) {
      return toast('Isi minimal satu material permintaan pembelian', 'error');
    }
    setBusy(true);
    try {
      const payload = { noFupa, tglFupa, sourceRfqId: ctx?.sourceRfqId ?? null, sourceNoRfq, cabang, customer, catatan, items, markSent };
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
      toast(markSent ? 'FUP A ditandai terkirim' : 'FUP A disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan FUP A', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={fupaId ? 'Edit FUP A' : 'Buat FUP A (Permintaan Pembelian)'}
      wide
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={sendWa}>
            <IconWa /> Kirim WhatsApp
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
          <label>Ref. No. RFQ</label>
          <input type="text" value={sourceNoRfq} onChange={(e) => setSourceNoRfq(e.target.value)} placeholder="RFQ asal" />
        </div>
        <div>
          <label>Cabang</label>
          <input type="text" value={cabang} onChange={(e) => setCabang(e.target.value.toUpperCase())} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Customer</label>
          <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Material yang Diminta</label>
        {items.map((it, idx) => (
          <div key={idx} className="rfq-item-row">
            <input type="text" placeholder="Line" value={it.line} onChange={(e) => setItem(idx, { line: e.target.value })} style={{ maxWidth: 70 }} />
            <input type="text" placeholder="Grade" value={it.grade} onChange={(e) => setItem(idx, { grade: e.target.value })} style={{ maxWidth: 110 }} />
            <input type="text" placeholder="Material" value={it.material} onChange={(e) => setItem(idx, { material: e.target.value })} />
            <input type="number" placeholder="Pcs" value={it.pcs} onChange={(e) => setItem(idx, { pcs: e.target.value })} style={{ maxWidth: 80 }} />
            <select value={it.lokal} onChange={(e) => setItem(idx, { lokal: e.target.value })} style={{ maxWidth: 160 }}>
              {RFQ_LOKAL_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>{o.l}</option>
              ))}
            </select>
            <button type="button" className="icon-btn danger" title="Hapus baris" onClick={() => setItems((prev) => (prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx)))}>
              <IconTrash />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4 }} onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          <IconPlus /> Tambah Material
        </button>
      </div>

      <div className="form-grid" style={{ marginTop: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Lampiran</label>
        <AttachmentList fupaId={fupaId} />
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Diskusi</label>
        <ItemChat entity="fupa" entityId={fupaId} />
      </div>
    </Modal>
  );
}
