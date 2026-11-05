'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { AttachmentList } from '../AttachmentList';
import { ItemChat } from '../ItemChat';
import { MaterialSpecEditor } from '../MaterialSpecEditor';
import { emptyRow, itemToRow, materialRowsToItemRows, materialToRow, rowToItem, type SpecRow } from '@/lib/material-spec';
import { IconDownload, IconMail, IconSave, IconWa } from '../icons';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { formatDateID, formatFileSize, getProspectMaterials, normalizePhone, num, todayStr } from '@/lib/format';
import { STATUS_META } from '@/lib/constants';
import { customerKey } from '@/lib/reports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Rfq, RfqItem } from '@/lib/types';
import { actualMargin, hasHpp, type RfqHppFields } from '@/lib/rfq-price';
import { canNow } from '@/hooks/useCan';


import { useT } from '@/store/useLangStore';
/** Purchasing's answer on one material, shown under the row once it exists. */
function PurchasingAnswer({ it }: { it?: RfqItem }) {
  const tr = useT();
  if (!it || !(it.hargaPurchasing || it.coo || it.note || it.deliveryTime || it.noQuote)) return null;
  return (
    <div className="import-summary" style={{ margin: 0 }}>
      <b>{tr("Jawaban Purchasing:")}</b>{' '}
      {it.noQuote ? (
        <span className="badge rust">{tr("No Quote")}</span>
      ) : (
        <>
          {it.hargaPurchasing ? `${it.currency || 'IDR'} ${Math.round(it.hargaPurchasing).toLocaleString('id-ID')}` : '-'}
          {it.uom ? ` / ${it.uom}` : ''}
          {it.deliveryTime ? ` · Delivery: ${it.deliveryTime}` : ''}
          {it.coo ? ` · Origin: ${it.coo}` : ''}
          {it.note ? ` · ${it.note}` : ''}
          {/* HPP & margin: hanya sampai ke RM / GM / Admin (server membuangnya untuk role lain). */}
          {hasHpp(it as RfqItem & RfqHppFields) && (
            <span className="hpp-info">
              {' '}· HPP {(it as RfqHppFields).hppCur || 'IDR'} {Number((it as RfqHppFields).hpp).toLocaleString('id-ID')}
              {(it as RfqHppFields).hppCur && (it as RfqHppFields).hppCur !== 'IDR' ? ` × ${Number((it as RfqHppFields).kurs || 0).toLocaleString('id-ID')}` : ''}
              {' '}· margin {(actualMargin(it as RfqItem & RfqHppFields) ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
              {(it as RfqHppFields).vendorNama ? ` · ${(it as RfqHppFields).vendorNama}` : ''}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function RfqModal() {
  const tr = useT();
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
  // Edited as spec rows (bentuk, ukuran, …); `items` is what gets stored / sent.
  const [rows, setRows] = useState<SpecRow[]>([emptyRow()]);
  const items = useMemo<RfqItem[]>(() => rows.map(rowToItem), [rows]);
  const [catatan, setCatatan] = useState('');
  const [purchWa, setPurchWa] = useState('');
  const [purchEmail, setPurchEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // Koneksi ke pipeline: prospek yang sudah terhubung, atau pilihan (id prospek / '__new' = buat prospek Permintaan baru).
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState('');
  /** Unread discussion at the moment the thread was opened, for the heading bubble. */
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!show || !ctx) return;
    setRfqId(ctx.rfqId);
    setChatUnread(0);
    setPurchWa(purchasingContact.wa || '');
    setPurchEmail(purchasingContact.email || '');

    setLinkedId(ctx.prospectId || null);
    setLinkPick('');
    if (ctx.rfqId) {
      const r = rfqs.find((x) => x.id === ctx.rfqId);
      if (r) {
        setLinkedId(r.prospectId || ctx.prospectId || null);
        setNoRfq(r.noRfq || '');
        setTglRfq(r.tglRfq || todayStr());
        setCabang(r.cabang || '');
        setCust(r.customer || '');
        setRows(r.items && r.items.length > 0 ? r.items.map(itemToRow) : [emptyRow()]);
        setCatatan(r.catatan || '');
      }
    } else if (ctx.prospectId) {
      const r = records.find((x) => x.id === ctx.prospectId);
      if (r) {
        setNoRfq('');
        setTglRfq(todayStr());
        setCabang(r.cabang || '');
        setCust(r.customer || '');
        // Same rows as the prospect (bentuk, ukuran, berat, Line 05), prices dropped.
        setRows(materialRowsToItemRows(getProspectMaterials(r).map(materialToRow), r.tglPO || ''));
      }
    } else {
      setNoRfq('');
      setTglRfq(todayStr());
      setCabang(currentUser?.cabang || '');
      setCust('');
      setRows([emptyRow()]);
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

  // Prospek aktif (Permintaan s.d. Negosiasi) untuk dihubungkan: customer yang sama dulu, lalu prospek lain di cabang ini.
  const linkCands = (() => {
    if (linkedId) return { same: [], other: [] };
    const key = customerKey(cust);
    const cab = cabang.trim().toUpperCase();
    const active = records.filter((p) => num(p.status) >= 1 && num(p.status) <= 3);
    const same = key ? active.filter((p) => customerKey(p.customer) === key) : [];
    const other = active.filter((p) => !same.includes(p) && (!cab || (p.cabang || '').toUpperCase() === cab)).slice(0, 150);
    return { same, other };
  })();
  const linkedProspect = linkedId ? records.find((p) => p.id === linkedId) || null : null;
  const canLinkView = canNow('prospek', 'v');
  const canNewProspect = canNow('prospek', 'e');
  const isNewRfq = !rfqId && !ctx?.prospectId;
  // Satu-satunya prospek aktif customer ini: langsung dipilihkan.
  const onlySame = linkCands.same.length === 1 ? linkCands.same[0].id : '';
  useEffect(() => {
    if (onlySame && !linkPick) setLinkPick(onlySame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlySame]);

  if (!ctx) return null;


  async function persistPurchasingContactIfChanged() {
    if (purchWa !== purchasingContact.wa || purchEmail !== purchasingContact.email) {
      const { purchasingContact: saved } = await api.put<{ purchasingContact: typeof purchasingContact }>('/api/settings/purchasing-contact', { wa: purchWa, email: purchEmail });
      setPurchasingContact(saved);
    }
  }

  async function saveOrUpdateRecord(markSent: boolean): Promise<Rfq> {
    const pick = !linkedId && linkPick ? linkPick : '';
    const body = {
      noRfq, tglRfq, cabang, customer: cust, requestedBy,
      prospectId: linkedId || (pick && pick !== '__new' ? pick : null),
      createProspect: pick === '__new',
      items, catatan, markSent,
    };
    const { rfq } = rfqId ? await api.put<{ rfq: Rfq }>(`/api/rfqs/${rfqId}`, body) : await api.post<{ rfq: Rfq }>('/api/rfqs', body);
    upsertRfq(rfq);
    if (!rfqId) setRfqId(rfq.id);
    if (rfq.prospectId) {
      if (!linkedId && pick) toast(pick === '__new' ? 'Prospek baru (Permintaan) dibuat dan terhubung ke RFQ ini' : 'RFQ terhubung ke prospek di pipeline', 'success');
      setLinkedId(rfq.prospectId);
      setLinkPick('');
    }
    // Nomor dibuat server saat kosong — tarik balik ke form, kalau tidak
    // simpan berikutnya (PUT) mengirim string kosong dan ditolak server.
    if (rfq.noRfq && rfq.noRfq !== noRfq) setNoRfq(rfq.noRfq);
    return rfq;
  }

  /**
   * Guard for any action that persists the RFQ, applied to all five buttons
   * rather than just Save. Only the material check remains: the number is now
   * generated server-side when left blank, so requiring it here would block a
   * flow that works fine.
   */
  function validate(): boolean {
    // No. RFQ tidak lagi wajib diisi manual — server membuatkan nomor urut
    // otomatis (RFQ-YYYY-NNNN) kalau dikosongkan.
    if (!hasMaterial()) {
      toast('Isi minimal satu material yang diminta', 'error');
      return false;
    }
    // RFQ baru dari Kelola RFQ wajib terhubung ke pipeline.
    if (isNewRfq && canLinkView && !linkedId && !linkPick) {
      toast('Pilih prospek di pipeline untuk RFQ ini, atau buat prospek baru', 'error');
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
      // WhatsApp hanya mengirim pesan; RFQ masuk modul Purchasing lewat tombol "Kirim ke Purchasing".
      await saveOrUpdateRecord(false);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`, '_blank');
      toast('RFQ dikirim via WhatsApp dan tersimpan di Kelola RFQ — belum masuk modul Purchasing', 'success');
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
      await saveOrUpdateRecord(false);
      const subject = encodeURIComponent(`RFQ ${noRfq || ''} - ${cabang || ''} - ${cust || ''}`);
      const text = messageText + '\n\nMohon lampirkan file Excel RFQ hasil unduhan pada email ini sebelum dikirim.';
      window.open(`mailto:${purchEmail}?subject=${subject}&body=${encodeURIComponent(text)}`, '_blank');
      toast('RFQ dikirim via Email dan tersimpan di Kelola RFQ — belum masuk modul Purchasing', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim RFQ', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Hands the RFQ to the internal Purchasing module (status -> Terkirim, stamps
   * sentToPurchasingAt). Only this button does that — WhatsApp / Email just
   * save the RFQ and open the outgoing message.
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
      title={canNow('rfq', 'e') ? tr("Buat RFQ ke Purchasing") : tr("RFQ (hanya-baca)")}
      wide2
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {tr("Tutup")}
          </button>
          {canNow('rfq', 'e') && (
            <button type="button" className="btn btn-outline" disabled={busy} onClick={onSaveDraft}>
              <IconSave /> {tr("Simpan RFQ")}
            </button>
          )}
          {canNow('rfq', 'x') && (
            <button type="button" className="btn btn-outline" disabled={busy} onClick={onExportExcel}>
              <IconDownload /> {tr("Export Excel")}
            </button>
          )}
          {canNow('rfq', 'e') && (
            <>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={onSendEmail}>
                <IconMail /> {tr("Kirim via Email")}
              </button>
              <button type="button" className="btn btn-wa" disabled={busy} onClick={onSendWa}>
                <IconWa /> {tr("Kirim via WhatsApp")}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onSendPurchasing}>
                {tr("Kirim ke Purchasing")}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>{tr("No. RFQ")}</label>
          <input type="text" value={noRfq} onChange={(e) => setNoRfq(e.target.value)} placeholder={rfqId ? '' : tr("Otomatis saat disimpan")} />
          {!rfqId && !noRfq.trim() && <div className="field-note">{tr("Dikosongkan saja — nomor urut dibuat otomatis (RFQ-")}{new Date().getFullYear()}{tr("-0001). Isi manual hanya jika perlu nomor khusus.")}</div>}
        </div>
        <div>
          <label>{tr("Tgl RFQ")}</label>
          <input type="date" value={tglRfq} onChange={(e) => setTglRfq(e.target.value)} />
        </div>
        <div>
          <label>{tr("Cabang")}</label>
          <input type="text" value={cabang} onChange={(e) => setCabang(e.target.value)} />
        </div>
        <div>
          <label>{tr("Customer (CUST)")}</label>
          <CustomerNameInput value={cust} onChange={setCust} />
        </div>
      </div>
      {canLinkView && (
        <div className={`rfq-link${linkedId ? ' ok' : isNewRfq ? ' need' : ' warn'}`}>
          <label>{tr('Prospek di pipeline')}{isNewRfq ? ' *' : ''}</label>
          {linkedId ? (
            <div>
              <span className="badge green">{tr('Terhubung')}</span>{' '}
              <b>{linkedProspect?.customer || cust || '-'}</b>
              {linkedProspect && (
                <span className="muted">
                  {' '}· {linkedProspect.cabang || '-'} · SE {linkedProspect.se || '-'} · {STATUS_META[num(linkedProspect.status)]?.label || linkedProspect.status}
                  {linkedProspect.uraian ? ` · ${linkedProspect.uraian.slice(0, 60)}` : ''}
                </span>
              )}
            </div>
          ) : (
            <>
              <select value={linkPick} onChange={(e) => setLinkPick(e.target.value)}>
                <option value="">{isNewRfq ? tr('— pilih prospek —') : tr('— belum terhubung, pilih prospek —')}</option>
                {linkCands.same.length > 0 && (
                  <optgroup label={tr('Prospek aktif customer ini')}>
                    {linkCands.same.map((p) => (
                      <option key={p.id} value={p.id}>{p.customer} · {p.cabang || '-'} · SE {p.se || '-'} · {STATUS_META[num(p.status)]?.label || p.status}{p.uraian ? ` · ${p.uraian.slice(0, 50)}` : ''}</option>
                    ))}
                  </optgroup>
                )}
                {canNewProspect && <option value="__new">{tr('+ Buat prospek baru (Permintaan) dari RFQ ini')}</option>}
                {linkCands.other.length > 0 && (
                  <optgroup label={tr('Prospek aktif lain')}>
                    {linkCands.other.map((p) => (
                      <option key={p.id} value={p.id}>{p.customer} · {p.cabang || '-'} · SE {p.se || '-'} · {STATUS_META[num(p.status)]?.label || p.status}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="field-note" style={{ margin: '4px 0 0' }}>
                {linkCands.same.length
                  ? `${linkCands.same.length} ${tr('prospek aktif untuk customer ini — pilih yang sesuai.')}`
                  : cust.trim()
                    ? tr('Belum ada prospek aktif untuk customer ini — pilih "Buat prospek baru" supaya RFQ masuk pipeline.')
                    : tr('Isi customer dulu; prospek aktif customer itu akan muncul di sini.')}{' '}
                {tr('RFQ yang terhubung: jawaban Purchasing tampil di kartu prospek dan HPP dipakai untuk cek margin Surat Penawaran.')}
              </div>
            </>
          )}
        </div>
      )}
      <div className="full" style={{ marginTop: 14 }}>
        <label>{tr("Daftar Material yang Diminta")}</label>
        <MaterialSpecEditor variant="doc" rows={rows} onChange={setRows} renderRowExtra={(row) => <PurchasingAnswer it={row.src as RfqItem | undefined} />} />
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>{tr("Catatan")}</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr("Catatan tambahan untuk Purchasing...")} />
        </div>
      </div>
      {(() => {
        const rec = rfqId ? rfqs.find((r) => r.id === rfqId) : null;
        return rec?.purchJawaban ? (
          <div className="import-summary" style={{ marginTop: 16 }}>
            <b>{tr("Jawaban Purchasing:")}</b> {rec.purchJawaban}
          </div>
        ) : null;
      })()}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>{tr("Lampiran File (maks.")} {formatFileSize(ATTACHMENT_MAX_BYTES)}{tr("/file)")}</label>
        <AttachmentList rfqId={rfqId} withProspect ensureParentId={async () => (await saveOrUpdateRecord(false)).id} />
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {tr("Diskusi")}
          {chatUnread > 0 && <span className="item-chat-bubble">{chatUnread > 9 ? '9+' : chatUnread}</span>}
        </label>
        <ItemChat entity="rfq" entityId={rfqId} onUnreadAtOpen={setChatUnread} />
      </div>
      <div className="form-grid" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div>
          <label>{tr("No. WhatsApp Purchasing")}</label>
          <input type="text" value={purchWa} onChange={(e) => setPurchWa(e.target.value)} placeholder={tr("cth. 08123456789")} />
        </div>
        <div>
          <label>{tr("Email Purchasing")}</label>
          <input type="text" value={purchEmail} onChange={(e) => setPurchEmail(e.target.value)} placeholder={tr("purchasing@tiraaustenite.com")} />
        </div>
      </div>
      <div className="import-summary" style={{ marginTop: 12 }}>
        {tr("Nomor WhatsApp & email Purchasing di atas otomatis diingat untuk RFQ berikutnya. Setelah export Excel, lampirkan filenya secara manual pada email sebelum dikirim.")}
      </div>
    </Modal>
  );
}
