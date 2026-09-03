'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { AttachmentList } from '../AttachmentList';
import { ItemChat } from '../ItemChat';
import { IconDownload, IconMail, IconPlus, IconSave, IconTrash, IconWa } from '../icons';
import { RFQ_LOKAL_OPTIONS } from '@/lib/constants';
import { formatDateID, formatRupiah, getProspectMaterials, normalizePhone, num, todayStr } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Rfq, RfqItem } from '@/lib/types';

const emptyItem = (): RfqItem => ({ line: '', grade: '', material: '', dia: '', thick: '', width: '', length: '', pcs: 1, berat: '', lokal: 'LOKAL ATAU IMPORT', estimasi: '' });

export function RfqModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'rfq';
  const ctx = useUiStore((s) => s.rfqCtx);
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const rfqs = useDataStore((s) => s.rfqs);
  const purchasingContact = useDataStore((s) => s.purchasingContact);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const setPurchasingContact = useDataStore((s) => s.setPurchasingContact);
  const toast = useDataStore((s) => s.toast);

  const [rfqId, setRfqId] = useState<string | null>(null);
  const [noRfq, setNoRfq] = useState('');
  const [tglRfq, setTglRfq] = useState('');
  const [cabang, setCabang] = useState('');
  const [cust, setCust] = useState('');
  const [items, setItems] = useState<RfqItem[]>([emptyItem()]);
  const [catatan, setCatatan] = useState('');
  const [purchWa, setPurchWa] = useState('');
  const [purchEmail, setPurchEmail] = useState('');
  const [busy, setBusy] = useState(false);
  /** Unread discussion at the moment the thread was opened, for the heading bubble. */
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!show || !ctx) return;
    setRfqId(ctx.rfqId);
    setChatUnread(0);
    setPurchWa(purchasingContact.wa || '');
    setPurchEmail(purchasingContact.email || '');

    if (ctx.rfqId) {
      const r = rfqs.find((x) => x.id === ctx.rfqId);
      if (r) {
        setNoRfq(r.noRfq || '');
        setTglRfq(r.tglRfq || todayStr());
        setCabang(r.cabang || '');
        setCust(r.customer || '');
        setItems(r.items && r.items.length > 0 ? r.items.map((it) => ({ ...it })) : [emptyItem()]);
        setCatatan(r.catatan || '');
      }
    } else if (ctx.prospectId) {
      const r = records.find((x) => x.id === ctx.prospectId);
      if (r) {
        setNoRfq('');
        setTglRfq(todayStr());
        setCabang(r.cabang || '');
        setCust(r.customer || '');
        const materials = getProspectMaterials(r);
        setItems(
          materials.map((m) => ({ line: m.line || '', grade: '', material: m.uraian || '', dia: '', thick: '', width: '', length: '', pcs: num(m.qty) || 1, berat: '', lokal: 'LOKAL ATAU IMPORT', estimasi: r.tglPO || '' })),
        );
      }
    } else {
      setNoRfq('');
      setTglRfq(todayStr());
      setCabang(currentUser?.cabang || '');
      setCust('');
      setItems([emptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx]);

  const requestedBy = currentUser?.name || '';

  const messageText = useMemo(() => {
    const lines: string[] = [];
    lines.push('*REQUEST FOR QUOTATION (RFQ)*');
    lines.push(`No. RFQ: ${noRfq || '-'}`);
    lines.push(`Tanggal: ${formatDateID(tglRfq)}`);
    lines.push(`Cabang: ${cabang || '-'}`);
    lines.push(`Customer: ${cust || '-'}`);
    lines.push(`Diminta oleh: ${requestedBy || '-'}`);
    lines.push('');
    lines.push('Detail Material:');
    items.forEach((it, i) => {
      lines.push(`${i + 1}. Line ${it.line || '-'} | Grade ${it.grade || '-'}`);
      lines.push(`   ${it.material || '-'}`);
      const dims: string[] = [];
      if (it.dia) dims.push(`Dia ${it.dia}mm`);
      if (it.thick) dims.push(`Thick ${it.thick}mm`);
      if (it.width) dims.push(`Width ${it.width}mm`);
      if (it.length) dims.push(`Length ${it.length}mm`);
      if (dims.length) lines.push(`   ${dims.join(' x ')}`);
      lines.push(`   Qty: ${it.pcs || 0} pcs | Berat: ${it.berat || 0} kgs | ${it.lokal || '-'}`);
      if (it.estimasi) lines.push(`   Estimasi kebutuhan: ${formatDateID(it.estimasi)}`);
    });
    lines.push('');
    lines.push('Mohon segera diproses. Terima kasih.');
    return lines.join('\n');
  }, [noRfq, tglRfq, cabang, cust, requestedBy, items]);

  if (!ctx) return null;

  function updateItem(idx: number, patch: Partial<RfqItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function persistPurchasingContactIfChanged() {
    if (purchWa !== purchasingContact.wa || purchEmail !== purchasingContact.email) {
      const { purchasingContact: saved } = await api.put<{ purchasingContact: typeof purchasingContact }>('/api/settings/purchasing-contact', { wa: purchWa, email: purchEmail });
      setPurchasingContact(saved);
    }
  }

  async function saveOrUpdateRecord(markSent: boolean): Promise<Rfq> {
    const body = { noRfq, tglRfq, cabang, customer: cust, requestedBy, prospectId: ctx!.prospectId, items, catatan, markSent };
    const { rfq } = rfqId ? await api.put<{ rfq: Rfq }>(`/api/rfqs/${rfqId}`, body) : await api.post<{ rfq: Rfq }>('/api/rfqs', body);
    upsertRfq(rfq);
    if (!rfqId) setRfqId(rfq.id);
    return rfq;
  }

  /**
   * Both requirements for any action that persists the RFQ. Applied to all five
   * buttons rather than just Save: an RFQ that reaches Purchasing without a
   * number shows as "(tanpa nomor)" everywhere and gives FUP A nothing to
   * reference. The server enforces the same rule.
   */
  function validate(): boolean {
    if (!noRfq.trim()) {
      toast('No. RFQ wajib diisi', 'error');
      return false;
    }
    if (!hasMaterial()) {
      toast('Isi minimal satu material yang diminta', 'error');
      return false;
    }
    return true;
  }

  function hasMaterial() {
    return items.some((it) => (it.material || '').trim());
  }

  async function onSaveDraft() {
    if (!validate()) return;
    setBusy(true);
    try {
      await saveOrUpdateRecord(false);
      toast('RFQ tersimpan sebagai draft di Kelola RFQ', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan RFQ', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onSendWa() {
    if (!validate()) return;
    const phone = normalizePhone(purchWa);
    if (phone.length < 9) return toast('Nomor WhatsApp Purchasing tidak valid.', 'error');
    setBusy(true);
    try {
      await persistPurchasingContactIfChanged();
      await saveOrUpdateRecord(true);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`, '_blank');
      toast('RFQ dikirim via WhatsApp dan tersimpan di Kelola RFQ', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim RFQ', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onSendEmail() {
    if (!validate()) return;
    setBusy(true);
    try {
      await persistPurchasingContactIfChanged();
      await saveOrUpdateRecord(true);
      const subject = encodeURIComponent(`RFQ ${noRfq || ''} - ${cabang || ''} - ${cust || ''}`);
      const text = messageText + '\n\nMohon lampirkan file Excel RFQ hasil unduhan pada email ini sebelum dikirim.';
      window.open(`mailto:${purchEmail}?subject=${subject}&body=${encodeURIComponent(text)}`, '_blank');
      toast('RFQ dikirim via Email dan tersimpan di Kelola RFQ', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim RFQ', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Hands the RFQ to the internal Purchasing module. Same `markSent` write as
   * the WA/Email buttons (status -> Terkirim, stamps sentToPurchasingAt), minus
   * the outgoing message to the external Purchasing contact.
   */
  async function onSendPurchasing() {
    if (!validate()) return;
    setBusy(true);
    try {
      await saveOrUpdateRecord(true);
      toast('RFQ berhasil dikirim ke modul Purchasing', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim RFQ ke Purchasing', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onExportExcel() {
    if (!validate()) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const header = ['NO', 'CABANG', 'NO RFQ', 'TGL RFQ', 'Line', 'GRADE', 'Material', 'DIA (mm)', 'THICK (mm)', 'WIDTH (mm)', 'LENGTH (mm)', 'PCS', 'BERAT (KGS)', 'CUST', 'Lokal/Import', 'estimasi kebutuhan'];
      const aoa: unknown[][] = [header];
      items.forEach((it, idx) => {
        aoa.push([idx === 0 ? 1 : '', idx === 0 ? cabang : '', idx === 0 ? noRfq : '', idx === 0 ? tglRfq : '', it.line, it.grade, it.material, it.dia || '', it.thick || '', it.width || '', it.length || '', it.pcs || '', it.berat || '', idx === 0 ? cust : '', it.lokal, it.estimasi || '']);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 4 }, { wch: 8 }, { wch: 9 }, { wch: 11 }, { wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 24 }, { wch: 16 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'RFQ');
      XLSX.writeFile(wb, `RFQ_${(noRfq || 'draft').replace(/[^a-zA-Z0-9]+/g, '_')}_${todayStr()}.xlsx`);
      await saveOrUpdateRecord(false);
      toast('File Excel RFQ berhasil diunduh dan tersimpan di Kelola RFQ', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengexport RFQ', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Buat RFQ ke Purchasing"
      wide2
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onSaveDraft}>
            <IconSave /> Simpan RFQ
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onExportExcel}>
            <IconDownload /> Export Excel
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onSendEmail}>
            <IconMail /> Kirim via Email
          </button>
          <button type="button" className="btn btn-wa" disabled={busy} onClick={onSendWa}>
            <IconWa /> Kirim via WhatsApp
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onSendPurchasing}>
            Kirim ke Purchasing
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>No. RFQ *</label>
          <input type="text" value={noRfq} onChange={(e) => setNoRfq(e.target.value)} placeholder="cth. 001" />
        </div>
        <div>
          <label>Tgl RFQ</label>
          <input type="date" value={tglRfq} onChange={(e) => setTglRfq(e.target.value)} />
        </div>
        <div>
          <label>Cabang</label>
          <input type="text" value={cabang} onChange={(e) => setCabang(e.target.value)} />
        </div>
        <div>
          <label>Customer (CUST)</label>
          <input type="text" value={cust} onChange={(e) => setCust(e.target.value)} />
        </div>
      </div>
      <div className="full" style={{ marginTop: 14 }}>
        <label>Daftar Material yang Diminta</label>
        {items.map((it, idx) => (
          <div className="rfq-item-card" key={idx}>
            {(it.hargaPurchasing || it.coo || it.note || it.deliveryTime || it.noQuote) && (
              <div className="import-summary" style={{ marginTop: 0, marginBottom: 8 }}>
                <b>Jawaban Purchasing:</b>{' '}
                {it.noQuote ? (
                  <span className="badge rust">No Quote</span>
                ) : (
                  <>
                    {it.hargaPurchasing ? `${it.currency || 'IDR'} ${Math.round(it.hargaPurchasing).toLocaleString('id-ID')}` : '-'}
                    {it.uom ? ` / ${it.uom}` : ''}
                    {it.deliveryTime ? ` · Delivery: ${it.deliveryTime}` : ''}
                    {it.coo ? ` · Origin: ${it.coo}` : ''}
                    {it.note ? ` · ${it.note}` : ''}
                  </>
                )}
              </div>
            )}
            <div className="rfq-item-head">
              <span>Material #{idx + 1}</span>
              <button type="button" className="icon-btn danger" disabled={items.length <= 1} onClick={() => removeItem(idx)} title="Hapus material">
                <IconTrash />
              </button>
            </div>
            <div className="form-grid">
              <div>
                <label>Line</label>
                <input type="text" value={it.line} onChange={(e) => updateItem(idx, { line: e.target.value })} />
              </div>
              <div>
                <label>Grade</label>
                <input type="text" value={it.grade} onChange={(e) => updateItem(idx, { grade: e.target.value })} />
              </div>
              <div className="full">
                <label>Material / Spesifikasi</label>
                <input type="text" value={it.material} onChange={(e) => updateItem(idx, { material: e.target.value })} placeholder="cth. 12 MM X 320 MM X 1333 MM" />
              </div>
              <div>
                <label>Dia (mm)</label>
                <input type="number" step="any" min={0} value={it.dia} onChange={(e) => updateItem(idx, { dia: e.target.value })} />
              </div>
              <div>
                <label>Thick (mm)</label>
                <input type="number" step="any" min={0} value={it.thick} onChange={(e) => updateItem(idx, { thick: e.target.value })} />
              </div>
              <div>
                <label>Width (mm)</label>
                <input type="number" step="any" min={0} value={it.width} onChange={(e) => updateItem(idx, { width: e.target.value })} />
              </div>
              <div>
                <label>Length (mm)</label>
                <input type="number" step="any" min={0} value={it.length} onChange={(e) => updateItem(idx, { length: e.target.value })} />
              </div>
              <div>
                <label>PCS</label>
                <input type="number" step="any" min={0} value={it.pcs} onChange={(e) => updateItem(idx, { pcs: e.target.value })} />
              </div>
              <div>
                <label>Berat (KGS)</label>
                <input type="number" step="any" min={0} value={it.berat} onChange={(e) => updateItem(idx, { berat: e.target.value })} />
              </div>
              <div>
                <label>Lokal/Import</label>
                <select value={it.lokal} onChange={(e) => updateItem(idx, { lokal: e.target.value })}>
                  {RFQ_LOKAL_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Estimasi Kebutuhan</label>
                <input type="date" value={it.estimasi} onChange={(e) => updateItem(idx, { estimasi: e.target.value })} />
              </div>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4 }} onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          <IconPlus /> Tambah Material
        </button>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan untuk Purchasing..." />
        </div>
      </div>
      {(() => {
        const rec = rfqId ? rfqs.find((r) => r.id === rfqId) : null;
        return rec?.purchJawaban ? (
          <div className="import-summary" style={{ marginTop: 16 }}>
            <b>Jawaban Purchasing:</b> {rec.purchJawaban}
          </div>
        ) : null;
      })()}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Lampiran File (maks. 3 file, 1.5MB/file)</label>
        <AttachmentList rfqId={rfqId} ensureParentId={async () => (await saveOrUpdateRecord(false)).id} />
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Diskusi
          {chatUnread > 0 && <span className="item-chat-bubble">{chatUnread > 9 ? '9+' : chatUnread}</span>}
        </label>
        <ItemChat entity="rfq" entityId={rfqId} onUnreadAtOpen={setChatUnread} />
      </div>
      <div className="form-grid" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div>
          <label>No. WhatsApp Purchasing</label>
          <input type="text" value={purchWa} onChange={(e) => setPurchWa(e.target.value)} placeholder="cth. 08123456789" />
        </div>
        <div>
          <label>Email Purchasing</label>
          <input type="text" value={purchEmail} onChange={(e) => setPurchEmail(e.target.value)} placeholder="purchasing@tiraaustenite.com" />
        </div>
      </div>
      <div className="import-summary" style={{ marginTop: 12 }}>
        Nomor WhatsApp &amp; email Purchasing di atas otomatis diingat untuk RFQ berikutnya. Setelah export Excel, lampirkan filenya secara manual pada email sebelum dikirim.
      </div>
    </Modal>
  );
}
