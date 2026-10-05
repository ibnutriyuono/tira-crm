'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconMail, IconPlus, IconTrash } from '../icons';
import { escapeForFilename, formatDateLongID, formatRupiah, getPrimaryPic, getProspectMaterials, materialUnitPrice, num, todayStr } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Material, Prospect } from '@/lib/types';

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function generateDefaultNomor(r: Prospect): string {
  const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const now = new Date();
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `${seq}/TA-STL-${r.cabang || 'PST'}/${romanMonths[now.getMonth()]}/${now.getFullYear()}`;
}

interface QItem extends Material {
  total: number;
}

export function QuotationModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'quotation';
  const prospectId = useUiStore((s) => s.quotationProspectId);
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const record = prospectId ? records.find((r) => r.id === prospectId) || null : null;

  const [nomor, setNomor] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [kepada, setKepada] = useState('');
  const [pic, setPic] = useState('');
  const [alamat, setAlamat] = useState('');
  const [perihal, setPerihal] = useState('');
  const [items, setItems] = useState<Material[]>([{ line: '', uraian: '', qty: 1, beratPc: 0, hargaKg: 0, harga: 0 }]);
  const [ppn, setPpn] = useState(false);
  const [pembayaran, setPembayaran] = useState('30 hari setelah invoice diterima');
  const [pengiriman, setPengiriman] = useState('2-4 minggu setelah PO diterima / sesuai kondisi stock');
  const [berlaku, setBerlaku] = useState('14 hari kerja sejak tanggal penawaran');
  const [catatan, setCatatan] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!show || !record) return;
    const cust = customers.find((c) => (c.name || '').trim().toLowerCase() === (record.customer || '').trim().toLowerCase());
    const custPic = getPrimaryPic(cust);
    setNomor(generateDefaultNomor(record));
    setTanggal(todayStr());
    setKepada(record.customer || '');
    setPic(custPic?.nama || '');
    setAlamat(cust?.address || '');
    setPerihal(`Penawaran Harga ${record.uraian || ''}`.slice(0, 120));
    setItems(getProspectMaterials(record).map((m) => ({ ...m })));
    setPpn(false);
    setPembayaran('30 hari setelah invoice diterima');
    setPengiriman('2-4 minggu setelah PO diterima / sesuai kondisi stock');
    setBerlaku('14 hari kerja sejak tanggal penawaran');
    setCatatan('');
    setEmail(custPic?.email || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, prospectId]);

  const collected = useMemo((): { items: QItem[]; total: number } => {
    const list = items.map((it) => {
      const unit = materialUnitPrice(it);
      return {
        line: (it.line || '').trim(),
        uraian: (it.uraian || '').trim(),
        qty: num(it.qty),
        beratPc: num(it.beratPc),
        hargaKg: num(it.hargaKg),
        harga: unit,
        total: num(it.qty) * unit,
      };
    });
    return { items: list, total: list.reduce((s, it) => s + it.total, 0) };
  }, [items]);

  if (!record) return null;

  function updateItem(idx: number, patch: Partial<Material>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function buildHtml(): string {
    const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
    const itemRows = collected.items
      .map(
        (it, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td style="text-align:center;">${escapeHtml(it.line)}</td>
        <td>${escapeHtml(it.uraian)}</td>
        <td style="text-align:center;">${it.qty}</td>
        <td style="text-align:right;">${formatRupiah(it.harga)}</td>
        <td style="text-align:right;">${formatRupiah(it.total)}</td>
      </tr>`,
      )
      .join('');
    return `
  <div style="font-family:Calibri, Arial, sans-serif; font-size:12pt; color:#000;">
    <table style="width:100%; border-bottom:2pt solid #1A222B; margin-bottom:16pt;"><tr><td>
      <div style="font-size:16pt; font-weight:bold; letter-spacing:1pt;">PT TIRA AUSTENITE</div>
      <div style="font-size:10pt; letter-spacing:2pt; color:#456484;">STEEL DIVISION</div>
    </td></tr></table>
    <p>No&nbsp;&nbsp;&nbsp;&nbsp;: ${escapeHtml(nomor)}<br>Lampiran&nbsp;: -<br>Perihal&nbsp;: <b>${escapeHtml(perihal)}</b></p>
    <p>${escapeHtml(formatDateLongID(tanggal))}</p>
    <p>Kepada Yth,<br>
    ${pic ? escapeHtml(pic) + '<br>' : ''}
    <b>${escapeHtml(kepada)}</b><br>
    ${alamat ? nl2br(alamat) + '<br>' : ''}
    di Tempat</p>
    <p>Dengan hormat,</p>
    <p>Sehubungan dengan permintaan Bapak/Ibu, dengan ini kami sampaikan penawaran harga sebagai berikut:</p>
    <table style="width:100%; border-collapse:collapse; margin:12pt 0;" border="1" cellpadding="6">
      <tr style="background:#1A222B; color:#fff;">
        <th style="width:5%;">No</th><th style="width:8%;">Line</th><th style="width:32%;">Uraian Material</th><th style="width:10%;">Qty</th><th style="width:20%;">Harga Satuan</th><th style="width:25%;">Total</th>
      </tr>
      ${itemRows}
      <tr>
        <td colspan="5" style="text-align:right;"><b>Total ${ppn ? '(sudah termasuk PPN 11%)' : '(belum termasuk PPN 11%)'}</b></td>
        <td style="text-align:right;"><b>${formatRupiah(collected.total)}</b></td>
      </tr>
    </table>
    <p><b>Syarat &amp; Ketentuan:</b></p>
    <table cellpadding="4">
      <tr><td style="width:140pt;">Pembayaran</td><td>: ${escapeHtml(pembayaran)}</td></tr>
      <tr><td>Pengiriman</td><td>: ${escapeHtml(pengiriman)}</td></tr>
      <tr><td>Masa Berlaku</td><td>: ${escapeHtml(berlaku)}</td></tr>
    </table>
    ${catatan ? `<p><b>Catatan:</b><br>${nl2br(catatan)}</p>` : ''}
    <p>Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.</p>
    <p>Hormat kami,<br><br><br><br>
    <b>${escapeHtml(currentUser?.name || '')}</b><br>
    PT Tira Austenite - Steel Division</p>
  </div>`;
  }

  async function markSent() {
    if (!record || record.penawaranTerkirim) return;
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${record.id}`, { penawaranTerkirim: true });
      upsertProspect(prospect);
    } catch {
      /* non-blocking */
    }
  }

  function validate(): boolean {
    if (!kepada.trim()) {
      toast('Nama customer/tujuan wajib diisi', 'error');
      return false;
    }
    if (!collected.items.some((it) => it.uraian)) {
      toast('Isi minimal satu uraian material', 'error');
      return false;
    }
    return true;
  }

  function onDownload() {
    if (!validate()) return;
    const htmlBody = buildHtml();
    const preHtml =
      "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Surat Penawaran</title></head><body>";
    const postHtml = '</body></html>';
    const full = preHtml + htmlBody + postHtml;
    const blob = new Blob(['﻿', full], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Penawaran_${escapeForFilename(kepada || 'Customer')}_${todayStr()}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Surat penawaran (.doc) berhasil diunduh', 'success');
    markSent();
  }

  function onSendEmail() {
    if (!validate()) return;
    const ringkasMaterial = collected.items
      .filter((it) => it.uraian)
      .map((it) => it.uraian)
      .join(', ');
    const subject = encodeURIComponent(`Penawaran Harga - ${perihal || ringkasMaterial || ''}`);
    const bodyLines = [
      `Yth. ${pic || kepada},`,
      '',
      `Bersama email ini kami sampaikan penawaran harga untuk ${ringkasMaterial || 'material yang diminta'} (No. ${nomor}).`,
      'Mohon lampirkan file Word hasil unduhan (.doc) pada email ini sebelum dikirim.',
      '',
      'Terima kasih.',
      '',
      currentUser?.name || '',
      'PT Tira Austenite - Steel Division',
    ];
    window.open(`mailto:${email}?subject=${subject}&body=${encodeURIComponent(bodyLines.join('\n'))}`, '_blank');
    markSent();
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Buat Surat Penawaran"
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-outline" onClick={onSendEmail}>
            <IconMail /> Kirim via Email
          </button>
          <button type="button" className="btn btn-primary" onClick={onDownload}>
            <IconDownload /> Unduh Word (.doc)
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>Nomor Surat</label>
          <input type="text" value={nomor} onChange={(e) => setNomor(e.target.value)} />
        </div>
        <div>
          <label>Tanggal</label>
          <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </div>
        <div>
          <label>Kepada (Customer)</label>
          <input type="text" value={kepada} onChange={(e) => setKepada(e.target.value)} />
        </div>
        <div>
          <label>PIC / Kontak</label>
          <input type="text" value={pic} onChange={(e) => setPic(e.target.value)} />
        </div>
        <div className="full">
          <label>Alamat</label>
          <textarea style={{ minHeight: 44 }} value={alamat} onChange={(e) => setAlamat(e.target.value)} />
        </div>
        <div className="full">
          <label>Perihal</label>
          <input type="text" value={perihal} onChange={(e) => setPerihal(e.target.value)} />
        </div>
        <div className="full">
          <label>Daftar Material yang Ditawarkan</label>
          <div className="qitem-header">
            <span>Line</span>
            <span>Uraian Material</span>
            <span>Qty</span>
            <span>Harga Satuan</span>
            <span>Total</span>
            <span></span>
          </div>
          {items.map((it, idx) => (
            <div className="qitem-row" key={idx}>
              <input type="text" placeholder="Line" value={it.line} onChange={(e) => updateItem(idx, { line: e.target.value })} />
              <input type="text" placeholder="Uraian material" value={it.uraian} onChange={(e) => updateItem(idx, { uraian: e.target.value })} />
              <input type="number" min={0} step="any" value={it.qty} onChange={(e) => updateItem(idx, { qty: num(e.target.value) })} />
              <input type="number" min={0} step="any" value={it.harga} onChange={(e) => updateItem(idx, { harga: num(e.target.value) })} />
              <div className="qi-total mono">{formatRupiah(num(it.qty) * num(it.harga))}</div>
              <button type="button" className="icon-btn danger qi-remove" disabled={items.length <= 1} onClick={() => removeItem(idx)}>
                <IconTrash />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => setItems((prev) => [...prev, { line: '', uraian: '', qty: 1, beratPc: 0, hargaKg: 0, harga: 0 }])}>
            <IconPlus /> Tambah Material
          </button>
        </div>
        <div className="full" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Total Keseluruhan</span>
          <input type="text" readOnly value={formatRupiah(collected.total)} style={{ maxWidth: 200, fontFamily: "var(--font-ibm-plex-mono), monospace", fontWeight: 600, textAlign: 'right', background: 'var(--steel-100)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={ppn} onChange={(e) => setPpn(e.target.checked)} id="q_ppn" />
          <label htmlFor="q_ppn" style={{ margin: 0, textTransform: 'none', fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>
            Harga sudah termasuk PPN 11%
          </label>
        </div>
        <div>
          <label>Syarat Pembayaran</label>
          <input type="text" value={pembayaran} onChange={(e) => setPembayaran(e.target.value)} />
        </div>
        <div>
          <label>Syarat Pengiriman</label>
          <input type="text" value={pengiriman} onChange={(e) => setPengiriman(e.target.value)} />
        </div>
        <div>
          <label>Masa Berlaku Penawaran</label>
          <input type="text" value={berlaku} onChange={(e) => setBerlaku(e.target.value)} />
        </div>
        <div className="full">
          <label>Catatan Tambahan (opsional)</label>
          <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
        <div className="full">
          <label>Email Tujuan (untuk kirim email)</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" />
        </div>
      </div>
      <div className="import-summary" style={{ marginTop: 14 }}>
        Catatan: karena keterbatasan browser, file Word tidak dapat otomatis terlampir di email. Unduh dulu file Word-nya, lalu lampirkan secara manual sebelum mengirim email.
      </div>
    </Modal>
  );
}
