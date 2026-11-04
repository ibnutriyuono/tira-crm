'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconMail, IconPlus, IconSave, IconTrash } from '../icons';
import { api } from '@/lib/api-client';
import { formatDateID } from '@/lib/format';
import { emptySppLine, filledLines, lineJumlah, SPP_ROWS_PER_PAGE, sppTotals, type SppDoc, type SppLine } from '@/lib/spp-doc';
import { downloadSppDoc } from '@/lib/spp-download';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

/**
 * Form SPP (Surat Penerimaan Pesanan) FUP A: terisi otomatis dari CRM, bisa
 * diedit dan dilengkapi manual (NPWP, BUMN, No OE, jangka waktu bayar,
 * pemeriksa / penyetuju, baris tambahan), disimpan di FUP A, lalu diunduh
 * sebagai Excel (form resmi) / Word, atau dikirim lewat email dengan lampiran.
 */
export function SppFormModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'sppForm');
  const ctx = useUiStore((s) => s.sppCtx);
  const openModal = useUiStore((s) => s.openModal);
  const closeRaw = useUiStore((s) => s.closeModal);
  const close = () => (ctx?.returnTo ? openModal(ctx.returnTo) : closeRaw());
  const toast = useDataStore((s) => s.toast);
  const purchasingContact = useDataStore((s) => s.purchasingContact);

  const [doc, setDoc] = useState<SppDoc | null>(null);
  const [auto, setAuto] = useState<SppDoc | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState({ to: '', cc: '', subject: '', message: '', xlsx: true, docx: false });

  useEffect(() => {
    if (!show || !ctx) return;
    let alive = true;
    setDoc(null);
    setMailOpen(false);
    setDirty(false);
    api
      .get<{ doc: SppDoc; auto: SppDoc; canEdit: boolean }>(`/api/fupas/${ctx.fupaId}/spp?format=json`)
      .then((r) => {
        if (!alive) return;
        setDoc({ ...r.doc, lines: r.doc.lines.length ? r.doc.lines : [emptySppLine()] });
        setAuto(r.auto);
        setCanEdit(r.canEdit);
        setMail({
          to: useDataStore.getState().purchasingContact.email || '',
          cc: '',
          subject: `SPP FUP A ${r.doc.noFupa} - ${r.doc.cabang} - ${r.doc.customer}`,
          message: `Dengan hormat,\n\nTerlampir Form SPP (Surat Penerimaan Pesanan) FUP A ${r.doc.noFupa} untuk ${r.doc.customer}${r.doc.noPo ? ` (PO ${r.doc.noPo})` : ''}.\nMohon diproses.\n\nTerima kasih.`,
          xlsx: true,
          docx: false,
        });
      })
      .catch((e) => alive && toast(e instanceof Error ? e.message : 'Gagal memuat Form SPP', 'error'));
    return () => {
      alive = false;
    };
  }, [show, ctx, toast]);

  const totals = useMemo(() => (doc ? sppTotals(doc) : { sub: 0, ppn: 0, grand: 0 }), [doc]);
  const pages = doc ? Math.max(1, Math.ceil(filledLines(doc).length / SPP_ROWS_PER_PAGE)) : 1;

  if (!ctx) return null;
  const set = (patch: Partial<SppDoc>) => {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const setLine = (i: number, patch: Partial<SppLine>) => doc && set({ lines: doc.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const ro = !canEdit;

  async function save() {
    if (!doc || !ctx) return;
    setBusy(true);
    try {
      const r = await api.put<{ doc: SppDoc }>(`/api/fupas/${ctx.fupaId}/spp`, { doc });
      setDoc({ ...r.doc, lines: r.doc.lines.length ? r.doc.lines : [emptySppLine()] });
      setDirty(false);
      toast('Form SPP disimpan', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function download(format: 'xlsx' | 'docx') {
    if (!doc || !ctx) return;
    setBusy(true);
    try {
      await downloadSppDoc(ctx.fupaId, doc, format);
      if (canEdit) setDirty(false);
      toast(`Form SPP (${format === 'docx' ? 'Word' : 'Excel'}) diunduh`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengunduh', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendMail() {
    if (!doc || !ctx) return;
    const formats = [mail.xlsx && 'xlsx', mail.docx && 'docx'].filter(Boolean);
    if (!formats.length) return toast(tr('Pilih minimal satu lampiran (Excel / Word).'), 'error');
    setBusy(true);
    try {
      const res = await fetch(`/api/fupas/${ctx.fupaId}/spp/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doc, to: mail.to, cc: mail.cc, subject: mail.subject, message: mail.message, formats }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 503 && body?.code === 'NO_SMTP') {
        // Tanpa server email: unduh lampirannya lalu buka aplikasi email.
        for (const f of formats) await downloadSppDoc(ctx.fupaId, doc, f as 'xlsx' | 'docx');
        window.open(`mailto:${encodeURIComponent(mail.to)}?cc=${encodeURIComponent(mail.cc)}&subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(`${mail.message}\n\n(Lampirkan file SPP yang baru diunduh.)`)}`, '_blank');
        toast('Server email belum diatur — file diunduh, lampirkan di aplikasi email Anda', 'info');
        return;
      }
      if (!res.ok) throw new Error(body?.error || 'Email gagal dikirim');
      setDirty(false);
      setMailOpen(false);
      toast(`Form SPP terkirim ke ${(body?.to || []).join(', ')}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Email gagal dikirim', 'error');
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof SppDoc, o: { type?: string; placeholder?: string; full?: boolean; disabled?: boolean } = {}) =>
    doc && (
      <div className={o.full ? 'full' : ''}>
        <label>{tr(label)}</label>
        <input type={o.type || 'text'} value={String(doc[key] ?? '')} disabled={ro || o.disabled} placeholder={o.placeholder ? tr(o.placeholder) : undefined} onChange={(e) => set({ [key]: e.target.value } as Partial<SppDoc>)} />
      </div>
    );

  return (
    <Modal
      show={show}
      onClose={close}
      title={`${tr('Form SPP')} — FUP A ${doc?.noFupa || ''}`}
      xwide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={close}>{tr('Tutup')}</button>
          {canEdit && (
            <button type="button" className="btn btn-outline" disabled={busy || !doc || !dirty} onClick={() => void save()}>
              <IconSave /> {tr('Simpan')}
            </button>
          )}
          <button type="button" className="btn btn-outline" disabled={busy || !doc} onClick={() => void download('xlsx')}>
            <IconDownload /> {tr('Unduh Excel')}
          </button>
          <button type="button" className="btn btn-outline" disabled={busy || !doc} onClick={() => void download('docx')}>
            <IconDownload /> {tr('Unduh Word')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !doc} onClick={() => setMailOpen((v) => !v)}>
            <IconMail /> {tr('Kirim Email')}
          </button>
        </>
      }
    >
      {!doc ? (
        <div className="field-note">{tr('Memuat…')}</div>
      ) : (
        <div className="spp">
          <div className="field-note" style={{ marginTop: 0 }}>
            {tr('Terisi otomatis dari CRM. Semua kolom bisa diubah dan dilengkapi manual; isian disimpan di FUP A ini. File Excel memakai form resmi (A4) — lebih dari 20 item otomatis lanjut ke halaman berikutnya.')}
            {ro && <b> {tr('Hanya-baca untuk role Anda — tetap bisa diunduh / dikirim.')}</b>}
          </div>

          {mailOpen && (
            <div className="spp-mail">
              <div className="form-grid">
                <div><label>{tr('Kepada')}</label><input type="text" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder={purchasingContact.email || tr('email@perusahaan.co.id')} /></div>
                <div><label>{tr('Cc')}</label><input type="text" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} placeholder={tr('opsional, pisahkan dengan koma')} /></div>
                <div className="full"><label>{tr('Subjek')}</label><input type="text" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
                <div className="full"><label>{tr('Pesan')}</label><textarea rows={4} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} /></div>
              </div>
              <div className="spp-mail-foot">
                <span>{tr('Lampiran')}:</span>
                <label><input type="checkbox" checked={mail.xlsx} onChange={(e) => setMail({ ...mail, xlsx: e.target.checked })} /> {tr('Form SPP (Excel)')}</label>
                <label><input type="checkbox" checked={mail.docx} onChange={(e) => setMail({ ...mail, docx: e.target.checked })} /> {tr('Form SPP (Word)')}</label>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void sendMail()}>{busy ? tr('Mengirim…') : tr('Kirim sekarang')}</button>
              </div>
            </div>
          )}

          <h4 className="spp-h">{tr('Kepala form')}</h4>
          <div className="spp-grid">
            <div>
              <label>FUP</label>
              <select value={doc.jenis} disabled={ro} onChange={(e) => set({ jenis: e.target.value as 'A' | 'B' })}>
                <option value="A">FUP- A</option>
                <option value="B">FUP- B</option>
              </select>
            </div>
            {field('No. FUP A', 'noFupa', { disabled: true })}
            {field('No. SPP', 'noSpp', { placeholder: 'diisi manual' })}
            {field('Tanggal', 'tgl', { type: 'date' })}
            {field('Cabang / Wilayah', 'cabang')}
          </div>

          <h4 className="spp-h">{tr('Langganan')}</h4>
          <div className="spp-grid">
            {field('Nama customer', 'customer', { full: true })}
            {field('NPWP', 'npwp', { placeholder: 'diisi manual' })}
            <div>
              <label>BUMN</label>
              <select value={doc.bumn} disabled={ro} onChange={(e) => set({ bumn: e.target.value as SppDoc['bumn'] })}>
                <option value="">—</option>
                <option value="ya">{tr('Ya')}</option>
                <option value="tidak">{tr('Tidak')}</option>
              </select>
            </div>
            {field('No. PO', 'noPo')}
            {field('No. OE', 'noOe', { placeholder: 'diisi manual' })}
            {field('Disetujui langganan', 'disetujuiLangganan', { placeholder: 'diisi manual' })}
          </div>

          <h4 className="spp-h">
            {tr('Pesanan')}
            {pages > 1 && <span className="spp-pages">{pages} {tr('halaman')}</span>}
            {canEdit && auto && (
              <button type="button" className="dk-link" onClick={() => set({ lines: auto.lines.length ? auto.lines : [emptySppLine()] })} title={tr('Ganti baris pesanan dengan data terbaru dari FUP A & prospek')}>
                {tr('Isi ulang dari CRM')}
              </button>
            )}
          </h4>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table spp-items">
              <colgroup>
                <col style={{ width: 36 }} /><col style={{ width: 110 }} /><col style={{ width: 90 }} /><col /><col style={{ width: 140 }} /><col style={{ width: 150 }} /><col style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr><th>No</th><th>{tr('Kuantitas')}</th><th>{tr('Satuan')}</th><th>{tr('Keterangan')}</th><th>{tr('Harga / satuan')}</th><th style={{ textAlign: 'right' }}>{tr('Jumlah')}</th><th /></tr>
              </thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i} className={i > 0 && i % SPP_ROWS_PER_PAGE === 0 ? 'spp-pagebreak' : ''}>
                    <td className="mono">{i + 1}</td>
                    <td><input type="number" min={0} step="any" value={l.qty || ''} disabled={ro} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} /></td>
                    <td><input type="text" value={l.satuan} disabled={ro} onChange={(e) => setLine(i, { satuan: e.target.value.toUpperCase() })} placeholder="KG" /></td>
                    <td><input type="text" value={l.keterangan} disabled={ro} onChange={(e) => setLine(i, { keterangan: e.target.value })} /></td>
                    <td><input type="number" min={0} step="any" value={l.harga || ''} disabled={ro} onChange={(e) => setLine(i, { harga: Number(e.target.value) || 0 })} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{lineJumlah(l) ? rp(lineJumlah(l)) : '-'}</td>
                    <td>
                      {!ro && (
                        <button type="button" className="icon-btn danger" aria-label={tr('Hapus baris')} onClick={() => set({ lines: doc.lines.length > 1 ? doc.lines.filter((_, k) => k !== i) : [emptySppLine()] })}>
                          <IconTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} className="spp-tl">{tr('Sub total')}</td><td className="mono spp-tv">{rp(totals.sub)}</td><td /></tr>
                <tr>
                  <td colSpan={5} className="spp-tl">
                    PPN <input type="number" min={0} max={100} step="any" className="spp-ppn" value={doc.ppn} disabled={ro} onChange={(e) => set({ ppn: Number(e.target.value) || 0 })} /> %
                  </td>
                  <td className="mono spp-tv">{rp(totals.ppn)}</td><td />
                </tr>
                <tr className="spp-grand"><td colSpan={5} className="spp-tl">{tr('Grand total')}</td><td className="mono spp-tv">{rp(totals.grand)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
          {!ro && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => set({ lines: [...doc.lines, emptySppLine()] })}>
              <IconPlus /> {tr('Tambah baris')}
            </button>
          )}

          <h4 className="spp-h">{tr('Instruksi & pengiriman')}</h4>
          <div className="spp-grid">
            <div className="full">
              <label>{tr('Instruksi khusus')}</label>
              <textarea rows={3} value={doc.instruksi} disabled={ro} onChange={(e) => set({ instruksi: e.target.value })} placeholder={tr('Satu instruksi per baris')} />
            </div>
            {field('Tgl pengiriman', 'tglKirim', { type: 'date' })}
            {field('Jangka waktu pembayaran', 'jangkaBayar', { placeholder: 'cth. 30 hari setelah invoice' })}
          </div>

          <h4 className="spp-h">{tr('Tanda tangan')}</h4>
          <div className="spp-sign">
            {([
              ['Dibuat oleh', 'dibuatOleh', 'tglDibuat'],
              ['Diperiksa oleh', 'diperiksaOleh', 'tglDiperiksa'],
              ['Disetujui oleh', 'disetujuiOleh', 'tglDisetujui'],
            ] as const).map(([label, nk, dk]) => (
              <div key={nk} className="spp-sign-col">
                <b>{tr(label)}</b>
                <input type="text" value={doc[nk]} disabled={ro} placeholder={tr('Nama')} onChange={(e) => set({ [nk]: e.target.value } as Partial<SppDoc>)} />
                <input type="date" value={doc[dk]} disabled={ro} onChange={(e) => set({ [dk]: e.target.value } as Partial<SppDoc>)} />
                {doc[dk] && <small className="field-note" style={{ margin: 0 }}>{formatDateID(doc[dk])}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
