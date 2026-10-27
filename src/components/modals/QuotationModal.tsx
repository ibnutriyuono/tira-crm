'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconMail, IconPlus, IconTrash } from '../icons';
import { escapeForFilename, getProspectMaterials, num, todayStr } from '@/lib/format';
import { normalizeCustomerName } from '@/lib/kam';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { canNow } from '@/hooks/useCan';
import { signatureUrl } from '../SignatureSection';
import { activityOwner } from '@/lib/sales-activity';
import { canQuoteOnBehalf } from '@/lib/roles';
import {
  QUOTE_DEFAULTS,
  QUOTE_OPT_GROUPS,
  defaultQuoteOpts,
  lineTotal,
  normalizeQuoteOpts,
  quoteHtml,
  quoteTotals,
  rupiah,
  unitPrice,
  type QuoteData,
  type QuoteItem,
  type QuoteLang,
  type QuoteOptKey,
  type QuoteOpts,
} from '@/lib/quotation-doc';

import { useT } from '@/store/useLangStore';
import { getLang } from '@/lib/i18n';
import { defaultEmailMessage, defaultEmailSubject, quoteEmailHtml, quoteEmailSummary, quoteEmailText } from '@/lib/quotation-email';
import { validEmail } from '@/lib/notif-prefs';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function generateDefaultNomor(r: Prospect): string {
  const now = new Date();
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `${seq}/TA-STL-${r.cabang || 'PST'}/${ROMAN[now.getMonth()]}/${now.getFullYear()}`;
}

const JABATAN: Record<string, string> = { sales: 'Sales Engineer', bm: 'Branch Manager', rm: 'Regional Manager', gm: 'General Manager', vp: 'Vice President', salesadmin: 'Admin Sales' };

// Pilihan tampilan, kop, kota & telepon penanda tangan diingat per browser.
interface MarginInfo {
  needs: boolean;
  minMargin: number;
  below: number;
  checked: number;
  lines: { idx: number; checked: boolean; below: boolean; margin?: number | null }[];
  approval: { id: string; status: string; decidedByName: string | null; decisionNote: string | null; createdAt: string } | null;
}

const LS = { opts: 'tira.quote.opts', kop: 'tira.quote.kop', kota: 'tira.quote.kota', telp: 'tira.quote.telp', lang: 'tira.quote.lang' };
const lsGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* mode privat: abaikan */
  }
};

/** Penanda tangan yang boleh dipilih (lihat /api/quotations/signers). */
interface Signer {
  id: string;
  name: string;
  role: string;
  se: string | null;
  email: string | null;
  jabatan: string;
  hasSignature: boolean;
  self: boolean;
  kind: 'self' | 'sales' | 'bm';
}
const telpKey = (s: Signer | null) => (!s || s.self ? LS.telp : `${LS.telp}.${s.id}`);

const blankItem = (): QuoteItem => ({ line: '', uraian: '', grade: '', satuan: 'pcs', qty: 1, beratPc: 0, hargaKg: 0, harga: 0 });

type Tab = 'isi' | 'tampilan' | 'pratinjau';

export function QuotationModal() {
  const tr = useT();
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
  const cust = useMemo(() => {
    if (!record) return null;
    const key = normalizeCustomerName(record.customer);
    return customers.find((c) => normalizeCustomerName(c.name) === key) || null;
  }, [record, customers]);
  const picOptions = useMemo(() => (cust?.pics?.length ? cust.pics : cust?.pic ? [{ id: 'legacy', nama: cust.pic, jabatan: null, phone: cust.phone, email: cust.email, isPrimary: true }] : []), [cust]);

  const [tab, setTab] = useState<Tab>('isi');
  // Margin vs HPP jawaban RFQ: di bawah batas → perlu persetujuan VP (lib/margin-check.ts).
  const [margin, setMargin] = useState<MarginInfo | null>(null);
  const [marginAlasan, setMarginAlasan] = useState('');
  const [marginBusy, setMarginBusy] = useState(false);
  const [opts, setOpts] = useState<QuoteOpts>(defaultQuoteOpts());
  const [d, setD] = useState<QuoteData | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // Catat ke Aktivitas Harian pembuat surat ("Kirim penawaran / dokumen").
  const [logAkt, setLogAkt] = useState(true);
  // Layar "Kirim via Email": email rapi + lampiran PDF (dan .docx bila dipilih).
  const [mailMode, setMailMode] = useState(false);
  const [mail, setMail] = useState({ to: '', cc: '', ccSelf: true, subject: '', message: '', docx: false });
  const [mailServer, setMailServer] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  // Admin Sales / BM: surat atas nama Sales pemilik prospek atau BM cabang.
  const onBehalfRole = canQuoteOnBehalf(currentUser?.role);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [signerId, setSignerId] = useState('');
  const signer = signers.find((s) => s.id === signerId) || null;
  const otherSigner = signer && !signer.self ? signer : null;

  useEffect(() => {
    if (!show || !record) return;
    const primary = picOptions.find((p) => p.isPrimary) || picOptions[0];
    const picLabel = (p: { nama: string; jabatan: string | null } | undefined) => (p ? `${p.nama}${p.jabatan ? ` (${p.jabatan})` : ''}` : '');
    let saved: unknown = null;
    try {
      saved = JSON.parse(lsGet(LS.opts) || 'null');
    } catch {
      saved = null;
    }
    setOpts(normalizeQuoteOpts(saved));
    setTab('isi');
    setMailMode(false);
    const mats = getProspectMaterials(record) as (ReturnType<typeof getProspectMaterials>[number] & { grade?: string; satuan?: string; fabNama?: string })[];
    // Bahasa surat terakhir dipakai; belum pernah memilih = ikut bahasa tampilan.
    const savedLang = lsGet(LS.lang);
    const lang: QuoteLang = savedLang === 'en' || savedLang === 'id' ? savedLang : getLang();
    const def = QUOTE_DEFAULTS[lang];
    setD({
      lang,
      nomor: generateDefaultNomor(record),
      tanggal: todayStr(),
      kota: lsGet(LS.kota) || '',
      lampiran: '-',
      perihal: `${def.perihal} ${record.uraian || ''}`.trim().slice(0, 120),
      kepada: record.customer || '',
      pic: picLabel(primary),
      alamat: cust?.address || '',
      items: mats.length
        ? mats.map((m) => ({
            line: m.line || '',
            uraian: m.uraian || '',
            grade: m.grade || '',
            satuan: m.fabNama !== undefined ? m.satuan || 'unit' : 'pcs',
            qty: num(m.qty) || 1,
            beratPc: num(m.beratPc),
            hargaKg: num(m.hargaKg),
            harga: num(m.harga),
          }))
        : [blankItem()],
      ppnInclude: false,
      pembayaran: def.pembayaran,
      pengiriman: def.pengiriman,
      berlaku: def.berlaku,
      kondisiStock: record.kondisiStock || '',
      catatan: '',
      signer: { nama: currentUser?.name || '', jabatan: JABATAN[currentUser?.role || ''] || '', telp: lsGet(LS.telp) || '', email: currentUser?.email || '' },
      kopText: lsGet(LS.kop) || '',
    });
    setEmail(primary?.email || '');
    setSigners([]);
    setSignerId('');
    if (onBehalfRole) {
      let alive = true;
      api
        .get<{ signers: Signer[]; defaultId: string | null }>(`/api/quotations/signers?prospectId=${encodeURIComponent(record.id)}`)
        .then((r) => {
          if (!alive) return;
          setSigners(r.signers);
          const def = r.signers.find((x) => x.id === r.defaultId);
          if (def) applySigner(def);
        })
        .catch(() => {
          /* tetap bisa memakai nama sendiri */
        });
      return () => {
        alive = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, prospectId]);

  /** Pakai nama, jabatan, email (dan telepon yang pernah diisi di browser ini) penanda tangan terpilih. */
  function applySigner(s: Signer) {
    setSignerId(s.id);
    setD((x) =>
      x
        ? { ...x, signer: { nama: s.name, jabatan: s.jabatan, email: s.email || '', telp: lsGet(telpKey(s)) || '' } }
        : x,
    );
  }

  const totals = useMemo(() => (d ? quoteTotals(d, opts) : null), [d, opts]);
  const sigSrc = otherSigner
    ? otherSigner.hasSignature && record
      ? `/api/quotations/signers/signature?prospectId=${encodeURIComponent(record.id)}&userId=${encodeURIComponent(otherSigner.id)}`
      : ''
    : signatureUrl(currentUser?.signatureAt);
  const preview = useMemo(() => (d && tab === 'pratinjau' ? quoteHtml(d, opts, '/logo.png', sigSrc) : ''), [d, opts, tab, sigSrc]);

  const marginItems = d ? d.items.map((it) => ({ line: it.line, uraian: it.uraian, grade: it.grade, qty: it.qty, beratPc: it.beratPc, hargaKg: it.hargaKg, harga: it.harga })) : [];
  const marginSig = JSON.stringify(marginItems);
  useEffect(() => {
    if (!show || !record) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .post<MarginInfo>('/api/quotations/margin', { prospectId: record.id, items: JSON.parse(marginSig) })
        .then((r) => alive && setMargin(r))
        .catch(() => alive && setMargin(null));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [show, record?.id, marginSig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!record || !d) return null;

  const set = (patch: Partial<QuoteData>) => setD((x) => (x ? { ...x, ...patch } : x));
  const setSigner = (patch: Partial<QuoteData['signer']>) => setD((x) => (x ? { ...x, signer: { ...x.signer, ...patch } } : x));
  const setItem = (idx: number, patch: Partial<QuoteItem>) => setD((x) => (x ? { ...x, items: x.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : x));
  const removeItem = (idx: number) => setD((x) => (x && x.items.length > 1 ? { ...x, items: x.items.filter((_, i) => i !== idx) } : x));
  const toggleOpt = (k: QuoteOptKey) =>
    setOpts((o) => {
      const n = { ...o, [k]: !o[k] };
      lsSet(LS.opts, JSON.stringify(n));
      return n;
    });

  /** Ganti bahasa surat; isian yang masih bawaan ikut diterjemahkan, isian yang sudah diubah dibiarkan. */
  function switchLang(next: QuoteLang) {
    if (!d || (d.lang || 'id') === next) return;
    const from = QUOTE_DEFAULTS[d.lang || 'id'];
    const to = QUOTE_DEFAULTS[next];
    const swap = (v: string, a: string, b: string) => (v.trim() === a ? b : v);
    set({
      lang: next,
      perihal: d.perihal.startsWith(from.perihal) ? to.perihal + d.perihal.slice(from.perihal.length) : d.perihal,
      pembayaran: swap(d.pembayaran, from.pembayaran, to.pembayaran),
      pengiriman: swap(d.pengiriman, from.pengiriman, to.pengiriman),
      berlaku: swap(d.berlaku, from.berlaku, to.berlaku),
    });
    lsSet(LS.lang, next);
  }

  function remember() {
    if (!d) return;
    lsSet(LS.kop, d.kopText);
    lsSet(LS.kota, d.kota);
    lsSet(telpKey(signer), d.signer.telp);
  }

  const canLogAkt = !!currentUser && (!!otherSigner || !!activityOwner(currentUser)) && canNow('aktivitas', 'e');

  /** Satu nomor surat = satu baris Aktivitas Harian (unduh ulang memperbarui baris yang sama). */
  async function logToActivity(kanal: 'email' | 'wa' | null) {
    if (!d || !record || !logAkt || !canLogAkt) return;
    try {
      const r = await api.post<{ created: boolean; owner: string }>('/api/sales-activities/quotation', {
        prospectId: record.id,
        nomor: d.nomor,
        tanggal: d.tanggal,
        customer: d.kepada,
        pic: d.pic,
        ringkas: d.items.filter((it) => it.uraian.trim()).map((it) => it.uraian.trim()).join(', '),
        total: totals ? rupiah(totals.grand).replace(/\u00A0/g, ' ') : '',
        kanal,
        ...(otherSigner ? { signerId: otherSigner.id } : {}),
      });
      if (r.created) toast(otherSigner ? `Tercatat di Aktivitas Harian ${r.owner} (Kirim penawaran / dokumen)` : 'Tercatat di Aktivitas Harian (Kirim penawaran / dokumen)', 'success');
    } catch (err) {
      toast(err instanceof Error ? `Aktivitas Harian: ${err.message}` : 'Gagal mencatat ke Aktivitas Harian', 'error');
    }
  }

  async function markSent() {
    if (!record || record.penawaranTerkirim || !canNow('prospek', 'e')) return;
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${record.id}`, { penawaranTerkirim: true });
      upsertProspect(prospect);
    } catch {
      /* non-blocking */
    }
  }


  /** Cek terakhir sebelum unduh / kirim. */
  async function marginOk(): Promise<boolean> {
    if (!record) return false;
    try {
      const r = await api.post<MarginInfo>('/api/quotations/margin', { prospectId: record.id, items: marginItems });
      setMargin(r);
      if (r.needs) {
        setTab('isi');
        toast(r.approval?.status === 'menunggu' ? tr('Menunggu persetujuan VP untuk harga ini') : `${tr('Margin di bawah')} ${r.minMargin}% — ${tr('ajukan persetujuan VP dulu')}`, 'error');
        return false;
      }
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memeriksa margin', 'error');
      return false;
    }
  }

  async function ajukanMargin() {
    if (!record || !d) return;
    setMarginBusy(true);
    try {
      const r = await api.post<MarginInfo>('/api/quotations/margin', { prospectId: record.id, items: marginItems, ajukan: true, alasan: marginAlasan, nomor: d.nomor });
      setMargin(r);
      setMarginAlasan('');
      toast(tr('Pengajuan dikirim ke VP'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengajukan', 'error');
    } finally {
      setMarginBusy(false);
    }
  }

  function validate(): boolean {
    if (!d) return false;
    if (!d.kepada.trim()) {
      toast('Nama customer/tujuan wajib diisi', 'error');
      return false;
    }
    if (!d.items.some((it) => it.uraian.trim())) {
      toast('Isi minimal satu uraian material', 'error');
      return false;
    }
    return true;
  }

  async function onDownload() {
    if (!d || !validate()) return;
    if (!(await marginOk())) return;
    setBusy(true);
    try {
      remember();
      const { buildQuoteDocx, loadLogo } = await import('@/lib/quotation-docx');
      const [logo, sig] = await Promise.all([opts.kop ? loadLogo() : null, opts.ttdGambar && sigSrc ? loadLogo(sigSrc) : null]);
      const blob = await buildQuoteDocx(d, opts, logo, sig);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Penawaran_${escapeForFilename(d.kepada || 'Customer')}_${d.tanggal || todayStr()}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Surat penawaran (.docx) berhasil diunduh', 'success');
      void markSent();
      void logToActivity(null);
    } catch (err) {
      toast(err instanceof Error ? `Gagal membuat file Word: ${err.message}` : 'Gagal membuat file Word', 'error');
    } finally {
      setBusy(false);
    }
  }

  const baseName = () => `Penawaran_${escapeForFilename(d?.kepada || 'Customer')}_${escapeForFilename(d?.nomor || '')}`.replace(/_+$/, '');

  async function makePdf(): Promise<Blob> {
    const { loadLogo } = await import('@/lib/quotation-docx');
    const { buildQuotePdf } = await import('@/lib/quotation-pdf');
    const [logo, sig] = await Promise.all([opts.kop ? loadLogo() : null, opts.ttdGambar && sigSrc ? loadLogo(sigSrc) : null]);
    return buildQuotePdf(d!, opts, logo, sig);
  }
  async function makeDocx(): Promise<Blob> {
    const { buildQuoteDocx, loadLogo } = await import('@/lib/quotation-docx');
    const [logo, sig] = await Promise.all([opts.kop ? loadLogo() : null, opts.ttdGambar && sigSrc ? loadLogo(sigSrc) : null]);
    return buildQuoteDocx(d!, opts, logo, sig);
  }
  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const toBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  async function onDownloadPdf() {
    if (!d || !validate()) return;
    if (!(await marginOk())) return;
    setBusy(true);
    try {
      remember();
      saveBlob(await makePdf(), `${baseName()}.pdf`);
      toast('Surat penawaran (PDF) berhasil diunduh', 'success');
      void markSent();
      void logToActivity(null);
    } catch (err) {
      toast(err instanceof Error ? `Gagal membuat PDF: ${err.message}` : 'Gagal membuat PDF', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Kirim lewat WhatsApp: di HP (HTTPS) PDF langsung dibagikan ke WhatsApp;
   * selain itu PDF diunduh lalu chat WhatsApp PIC dibuka dengan teks pengantar.
   */
  async function onSendWa() {
    if (!d || !validate()) return;
    if (!(await marginOk())) return;
    setBusy(true);
    try {
      remember();
      const pdf = await makePdf();
      const name = `${baseName()}.pdf`;
      const text = `${d.pic ? `Yth. ${d.pic},\n\n` : ''}Bersama ini kami kirimkan Surat Penawaran No. ${d.nomor} untuk ${d.kepada}. Mohon dapat dipelajari, kami siap membantu bila ada pertanyaan.\n\nSalam,\n${d.signer.nama || currentUser?.name || ''}\nPT. TIRA AUSTENITE, Tbk`;
      const file = new File([pdf], name, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (window.isSecureContext && nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: name });
      } else {
        saveBlob(pdf, name);
        const pic = picOptions.find((x) => x.isPrimary) || picOptions[0];
        const raw = (pic?.phone || cust?.phone || record?.phone || '').replace(/\D/g, '');
        const num62 = raw.startsWith('0') ? `62${raw.slice(1)}` : raw;
        window.open(`https://wa.me/${num62}?text=${encodeURIComponent(text)}`, '_blank');
        toast(`PDF diunduh (${name}) — lampirkan di chat WhatsApp yang terbuka`, 'success');
      }
      void markSent();
      void logToActivity('wa');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast(err instanceof Error ? err.message : 'Gagal menyiapkan WhatsApp', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Buka layar email: isian bawaan disusun dari surat (bahasa ikut bahasa surat). */
  async function onSendEmail() {
    if (!d || !validate()) return;
    if (!(await marginOk())) return;
    remember();
    // Atas nama orang lain: ia ikut menerima salinan (balasan customer juga ke emailnya).
    const ccSigner = otherSigner && d.signer.email && validEmail(d.signer.email) ? d.signer.email : '';
    setMail({ to: email, cc: ccSigner, ccSelf: !!currentUser?.email, subject: defaultEmailSubject(d), message: defaultEmailMessage(d), docx: false });
    setMailMode(true);
    if (mailServer === null) {
      api
        .get<{ configured: boolean }>('/api/quotations/email')
        .then((r) => setMailServer(!!r.configured))
        .catch(() => setMailServer(false));
    }
  }

  const mailList = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  async function onMailSubmit() {
    if (!d || !record) return;
    const to = mailList(mail.to);
    const cc = Array.from(new Set([...mailList(mail.cc), ...(mail.ccSelf && currentUser?.email ? [currentUser.email] : [])])).filter((x) => !to.includes(x));
    if (mailServer && !to.length) return toast('Isi alamat email customer', 'error');
    const bad = [...to, ...cc].find((x) => !validEmail(x));
    if (bad) return toast(`Alamat email tidak valid: ${bad}`, 'error');
    if (!mail.subject.trim() || !mail.message.trim()) return toast('Subjek dan isi pesan wajib diisi', 'error');
    if (!(await marginOk())) return;
    setSending(true);
    try {
      const pdf = await makePdf();
      const pdfName = `${baseName()}.pdf`;
      const summary = quoteEmailSummary(d, opts);
      if (!mailServer) {
        // Server belum punya SMTP: unduh PDF, buka aplikasi email dengan teks yang sudah rapi.
        saveBlob(pdf, pdfName);
        const text = quoteEmailText({ message: mail.message, summary, attachments: [pdfName], logoSrc: '' });
        const q = [`subject=${encodeURIComponent(mail.subject)}`, cc.length ? `cc=${encodeURIComponent(cc.join(','))}` : '', `body=${encodeURIComponent(text.replace(/\r?\n/g, '\r\n'))}`].filter(Boolean).join('&');
        window.open(`mailto:${to.join(',')}?${q}`, '_blank');
        toast(`PDF diunduh (${pdfName}) — lampirkan di email yang terbuka`, 'success');
      } else {
        const attachments = [{ filename: pdfName, content: await toBase64(pdf) }];
        if (mail.docx) attachments.push({ filename: `${baseName()}.docx`, content: await toBase64(await makeDocx()) });
        await api.post('/api/quotations/email', { prospectId: record.id, to, cc, subject: mail.subject.trim(), message: mail.message, summary, attachments, items: marginItems });
        toast(`Penawaran terkirim ke ${to.join(', ')}`, 'success');
        setMailMode(false);
      }
      void markSent();
      void logToActivity('email');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim email', 'error');
    } finally {
      setSending(false);
    }
  }

  const anyPerKg = d.items.some((it) => it.beratPc > 0 && it.hargaKg > 0);

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("Buat Surat Penawaran")}
      xwide
      footer={
        mailMode ? (
          <>
            <button type="button" className="btn btn-outline" onClick={() => setMailMode(false)} disabled={sending}>
              ← {tr("Kembali ke surat")}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy || sending} onClick={onDownloadPdf}>
              <IconDownload /> {tr("Unduh PDF")}
            </button>
            <button type="button" className="btn btn-primary" disabled={sending || mailServer === null} onClick={onMailSubmit}>
              <IconMail /> {sending ? tr("Mengirim…") : mailServer === false ? tr("Unduh PDF & buka aplikasi email") : tr("Kirim Email")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-outline" onClick={closeModal}>
              {tr("Tutup")}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={onSendWa}>
              {tr("Kirim via WhatsApp")}
            </button>
            <button type="button" className="btn btn-outline" onClick={onSendEmail}>
              <IconMail /> {tr("Kirim via Email")}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={onDownloadPdf}>
              <IconDownload /> {tr("Unduh PDF")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onDownload}>
              <IconDownload /> {busy ? tr("Menyiapkan…") : tr("Unduh Word (.docx)")}
            </button>
          </>
        )
      }
    >
      {mailMode && (
        <div className="qm">
          <div className="qm-form">
            <div className="qm-title">{tr("Kirim Penawaran via Email")}</div>
            {mailServer === false && (
              <div className="qm-warn">
                {tr("Server email CRM belum diatur. Tombol di bawah akan mengunduh PDF lalu membuka aplikasi email Anda dengan isi yang sudah rapi — lampirkan PDF yang terunduh sebelum mengirim.")}
              </div>
            )}
            <label>{tr("Kepada (email customer)")} *</label>
            <input type="text" list="qm-pics" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="nama@perusahaan.com" />
            <datalist id="qm-pics">
              {picOptions.filter((p) => p.email).map((p) => (
                <option key={p.id} value={p.email || ''}>{p.nama}</option>
              ))}
            </datalist>
            <div className="field-note">{tr("Pisahkan dengan koma bila lebih dari satu.")}</div>
            <label>{tr("CC")}</label>
            <input type="text" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} placeholder={tr("opsional, cth. atasan / admin sales")} />
            {currentUser?.email && (
              <label className="qm-check">
                <input type="checkbox" checked={mail.ccSelf} onChange={(e) => setMail({ ...mail, ccSelf: e.target.checked })} /> {tr("Kirim salinan ke saya")} ({currentUser.email})
              </label>
            )}
            <label>{tr("Subjek")}</label>
            <input type="text" value={mail.subject} maxLength={200} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
            <label>{tr("Pesan")}</label>
            <textarea rows={11} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} />
            <div className="field-note">{tr("Ringkasan penawaran, tanda tangan, dan lampiran ditambahkan otomatis — lihat pratinjau.")}</div>
            <label>{tr("Lampiran")}</label>
            <div className="qm-files">
              <span className="qm-file"><b className="pdf">PDF</b>{baseName()}.pdf</span>
              {mailServer !== false && (
                <label className="qm-check">
                  <input type="checkbox" checked={mail.docx} onChange={(e) => setMail({ ...mail, docx: e.target.checked })} /> {tr("Sertakan juga file Word (.docx)")}
                </label>
              )}
            </div>
          </div>
          <div className="qm-preview">
            <div className="qm-ptitle">{tr("Pratinjau email yang diterima customer")}</div>
            <iframe
              title={tr("Pratinjau email")}
              sandbox=""
              srcDoc={quoteEmailHtml({ message: mail.message, summary: quoteEmailSummary(d, opts), attachments: [`${baseName()}.pdf`, ...(mail.docx && mailServer !== false ? [`${baseName()}.docx`] : [])], logoSrc: '/logo.png' })}
            />
          </div>
        </div>
      )}
      {!mailMode && margin && margin.below > 0 && (
        <div className={`qm-margin ${margin.needs ? (margin.approval?.status === 'menunggu' ? 'wait' : 'bad') : 'ok'}`} role="status">
          <b>
            {margin.needs
              ? margin.approval?.status === 'menunggu'
                ? `⏳ ${tr('Menunggu persetujuan VP')}`
                : `⚠ ${margin.below} ${tr('item dengan margin di bawah')} ${margin.minMargin}% ${tr('dari HPP')}`
              : `✓ ${tr('Margin di bawah batas sudah disetujui')}${margin.approval?.decidedByName ? ` — ${margin.approval.decidedByName}` : ''}`}
          </b>
          {margin.needs && margin.approval?.status === 'ditolak' && (
            <span>
              {tr('Pengajuan sebelumnya ditolak')}
              {margin.approval.decidedByName ? ` (${margin.approval.decidedByName})` : ''}
              {margin.approval.decisionNote ? `: ${margin.approval.decisionNote}` : ''} — {tr('ubah harga atau ajukan lagi dengan alasan.')}
            </span>
          )}
          {margin.needs && margin.approval?.status !== 'menunggu' && (
            <>
              <span>{tr('Surat belum bisa diunduh atau dikirim. Naikkan harga item yang ditandai, atau ajukan persetujuan VP.')}</span>
              <span className="qm-margin-act">
                <input type="text" value={marginAlasan} placeholder={tr('Alasan (mis. customer strategis, harga kompetitor)')} onChange={(e) => setMarginAlasan(e.target.value)} />
                <button type="button" className="btn btn-primary btn-sm" disabled={marginBusy || marginAlasan.trim().length < 5} onClick={ajukanMargin}>
                  {tr('Ajukan ke VP')}
                </button>
              </span>
            </>
          )}
          {margin.needs && margin.approval?.status === 'menunggu' && <span>{tr('Anda akan diberi notifikasi begitu VP memutuskan. Mengubah harga membatalkan pengajuan ini.')}</span>}
        </div>
      )}
      {!mailMode && (<>
      <div className="sa-pills q-tabs" role="tablist" aria-label={tr("Bagian surat penawaran")}>
        {(
          [
            ['isi', tr("Isi surat")],
            ['tampilan', tr("Data yang ditampilkan")],
            ['pratinjau', tr("Pratinjau")],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'isi' && (
        <div className="form-grid">
          <div className="full q-lang">
            <label>{tr("Bahasa surat")}</label>
            <div className="seg">
              <button type="button" className={`btn btn-sm ${(d.lang || 'id') === 'id' ? 'btn-primary' : 'btn-outline'}`} onClick={() => switchLang('id')}>{tr("Indonesia")}</button>
              <button type="button" className={`btn btn-sm ${d.lang === 'en' ? 'btn-primary' : 'btn-outline'}`} onClick={() => switchLang('en')}>{tr("English")}</button>
            </div>
            <span className="field-note" style={{ margin: 0 }}>{tr("Teks tetap surat, tanggal, terbilang, dan syarat bawaan ikut berganti. Uraian material tetap seperti diisi.")}</span>
          </div>
          <div>
            <label>{tr("Nomor Surat")}</label>
            <input type="text" value={d.nomor} onChange={(e) => set({ nomor: e.target.value })} />
          </div>
          <div className="q-2">
            <div>
              <label>{tr("Kota")}</label>
              <input type="text" value={d.kota} placeholder={tr("cth. Jakarta")} onChange={(e) => set({ kota: e.target.value })} />
            </div>
            <div>
              <label>{tr("Tanggal")}</label>
              <input type="date" value={d.tanggal} onChange={(e) => set({ tanggal: e.target.value })} />
            </div>
          </div>
          <div>
            <label>{tr("Kepada (Customer)")}</label>
            <input type="text" value={d.kepada} onChange={(e) => set({ kepada: e.target.value })} />
          </div>
          <div>
            <label>{tr("PIC / Up.")}</label>
            <input type="text" list="q-pic-list" value={d.pic} placeholder={picOptions.length ? tr("pilih atau ketik") : tr("nama PIC (jabatan)")} onChange={(e) => set({ pic: e.target.value })} />
            <datalist id="q-pic-list">
              {picOptions.map((p) => (
                <option key={p.id} value={`${p.nama}${p.jabatan ? ` (${p.jabatan})` : ''}`} />
              ))}
            </datalist>
            {!cust && <div className="field-note">{tr("Customer belum ada di Kelola Customer — PIC & alamat diisi manual.")}</div>}
          </div>
          <div className="full">
            <label>{tr("Alamat")}</label>
            <textarea style={{ minHeight: 44 }} value={d.alamat} onChange={(e) => set({ alamat: e.target.value })} />
          </div>
          <div className={opts.lampiran ? '' : 'full'}>
            <label>{tr("Perihal")}</label>
            <input type="text" value={d.perihal} onChange={(e) => set({ perihal: e.target.value })} />
          </div>
          {opts.lampiran && (
            <div>
              <label>{tr("Lampiran")}</label>
              <input type="text" value={d.lampiran} onChange={(e) => set({ lampiran: e.target.value })} />
            </div>
          )}

          <div className="full">
            <label>{tr("Daftar Material yang Ditawarkan")}</label>
            <div className="qitem-header">
              <span>{tr("Line")}</span>
              <span>{tr("Uraian Material")}</span>
              <span>{tr("Qty")}</span>
              <span>{tr("Satuan")}</span>
              <span>{tr("Berat/pcs (kg)")}</span>
              <span>{tr("Harga/kg")}</span>
              <span>{tr("Harga Satuan")}</span>
              <span style={{ textAlign: 'right' }}>{tr("Jumlah")}</span>
              <span></span>
            </div>
            {d.items.map((it, idx) => {
              const perKg = it.beratPc > 0 && it.hargaKg > 0;
              const ml = margin?.lines.find((l) => l.idx === idx);
              return (
                <div className={`qitem-row${ml?.below ? ' qm-low' : ''}`} key={idx} title={ml?.below ? (ml.margin != null ? `${tr('Margin')} ${ml.margin.toLocaleString('id-ID')}% — ${tr('di bawah')} ${margin?.minMargin}%` : `${tr('Di bawah margin minimum')} ${margin?.minMargin}%`) : ml?.checked && ml.margin != null ? `${tr('Margin')} ${ml.margin.toLocaleString('id-ID')}%` : undefined}>
                  <input type="text" aria-label={tr("Line")} placeholder={tr("Line")} value={it.line} onChange={(e) => setItem(idx, { line: e.target.value })} />
                  <input type="text" aria-label={tr("Uraian material")} placeholder={tr("Uraian material")} value={it.uraian} onChange={(e) => setItem(idx, { uraian: e.target.value })} />
                  <input type="number" aria-label={tr("Qty")} min={0} step="any" value={it.qty} onChange={(e) => setItem(idx, { qty: num(e.target.value) })} />
                  <input type="text" aria-label={tr("Satuan")} value={it.satuan} onChange={(e) => setItem(idx, { satuan: e.target.value })} />
                  <input type="number" aria-label={tr("Berat per pcs (kg)")} min={0} step="any" value={it.beratPc || ''} placeholder="-" onChange={(e) => setItem(idx, { beratPc: num(e.target.value) })} />
                  <input type="number" aria-label={tr("Harga per kg")} min={0} step="any" value={it.hargaKg || ''} placeholder="-" onChange={(e) => setItem(idx, { hargaKg: num(e.target.value) })} />
                  <input
                    type="number"
                    aria-label={tr("Harga satuan")}
                    min={0}
                    step="any"
                    value={perKg ? Math.round(unitPrice(it)) : it.harga}
                    readOnly={perKg}
                    title={perKg ? tr("Dihitung dari berat/pcs × harga/kg. Kosongkan harga/kg untuk mengisi harga satuan langsung.") : undefined}
                    className={perKg ? 'q-calc' : undefined}
                    onChange={(e) => setItem(idx, { harga: num(e.target.value) })}
                  />
                  <div className="qi-total mono">{rupiah(lineTotal(it))}</div>
                  <button type="button" className="icon-btn danger qi-remove" aria-label={tr("Hapus material")} disabled={d.items.length <= 1} onClick={() => removeItem(idx)}>
                    <IconTrash />
                  </button>
                </div>
              );
            })}
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => set({ items: [...d.items, blankItem()] })}>
              <IconPlus /> {tr("Tambah Material")}
            </button>
            {anyPerKg && <div className="field-note">{tr("Harga satuan = berat/pcs × harga/kg (abu-abu = dihitung otomatis).")}</div>}
          </div>

          <div className="full q-totals">
            <label className="q-ppn">
              <input type="checkbox" checked={d.ppnInclude} onChange={(e) => set({ ppnInclude: e.target.checked })} />
              {tr("Harga yang diisi sudah termasuk PPN 11%")}
            </label>
            <div className="q-sum">
              {totals?.rows.map((r) => (
                <div key={r.label} className={r.bold ? 'q-sum-grand' : ''}>
                  <span>{r.label}</span>
                  <b className="mono">{r.value}</b>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label>{tr("Syarat Pembayaran")}</label>
            <input type="text" value={d.pembayaran} onChange={(e) => set({ pembayaran: e.target.value })} />
          </div>
          <div>
            <label>{tr("Syarat Pengiriman")}</label>
            <input type="text" value={d.pengiriman} onChange={(e) => set({ pengiriman: e.target.value })} />
          </div>
          <div>
            <label>{tr("Masa Berlaku Penawaran")}</label>
            <input type="text" value={d.berlaku} onChange={(e) => set({ berlaku: e.target.value })} />
          </div>
          <div>
            <label>{tr("Kondisi Stock")}</label>
            <input type="text" value={d.kondisiStock} onChange={(e) => set({ kondisiStock: e.target.value })} />
          </div>
          <div className="full">
            <label>{tr("Catatan Tambahan (opsional)")}</label>
            <textarea value={d.catatan} onChange={(e) => set({ catatan: e.target.value })} />
          </div>

          <div className="full q-section">{tr("Penanda tangan")}</div>
          {signers.length > 1 && (
            <div className="full q-onbehalf">
              <label>{tr("Atas nama")}</label>
              <select value={signerId} onChange={(e) => { const s = signers.find((x) => x.id === e.target.value); if (s) applySigner(s); }}>
                {signers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {tr(s.jabatan || s.role)}{s.se && s.kind === 'sales' ? ` · ${s.se}` : ''}{s.self ? ` (${tr("saya")})` : s.kind === 'sales' ? ` (${tr("Sales prospek ini")})` : ''}
                  </option>
                ))}
              </select>
              {otherSigner && (
                <div className="field-note">
                  {tr("Surat dibuat atas nama")} <b>{otherSigner.name}</b>{tr(": nama, jabatan, email, dan tanda tangannya dipakai di surat; balasan customer masuk ke emailnya, dan surat tercatat di Aktivitas Harian-nya. Log mencatat Anda sebagai pembuat.")}
                </div>
              )}
            </div>
          )}
          <div className="full q-sigrow">
            {sigSrc ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigSrc} alt={otherSigner ? `${tr("Tanda tangan")} ${otherSigner.name}` : tr("Tanda tangan Anda")} />
                <span className="field-note" style={{ margin: 0 }}>
                  {!opts.ttdGambar
                    ? tr("Tanda tangan tidak dipasang (dimatikan di tab \"Data yang ditampilkan\").")
                    : otherSigner
                      ? `${tr("Tanda tangan")} ${otherSigner.name} ${tr("dipasang otomatis di surat.")}`
                      : tr("Tanda tangan Anda dipasang otomatis di surat.")}
                </span>
              </>
            ) : otherSigner ? (
              <span className="field-note" style={{ margin: 0 }}>
                <b>{otherSigner.name}</b> {tr("belum menyimpan tanda tangan di Akun Saya — surat dibuat tanpa gambar tanda tangan (bisa ditandatangani basah setelah dicetak).")}
              </span>
            ) : (
              <span className="field-note" style={{ margin: 0 }}>
                {tr("Belum ada tanda tangan. Tambahkan lewat tombol")} <b>{tr("Akun Saya")}</b> {tr("di atas — selanjutnya otomatis terpasang di setiap surat penawaran Anda.")}
              </span>
            )}
          </div>
          <div>
            <label>{tr("Nama")}</label>
            <input type="text" value={d.signer.nama} onChange={(e) => setSigner({ nama: e.target.value })} />
          </div>
          <div>
            <label>{tr("Jabatan")}</label>
            <input type="text" value={d.signer.jabatan} onChange={(e) => setSigner({ jabatan: e.target.value })} />
          </div>
          <div>
            <label>{tr("Telepon / WA")}</label>
            <input type="tel" value={d.signer.telp} placeholder={tr("08xx…")} onChange={(e) => setSigner({ telp: e.target.value })} />
          </div>
          <div>
            <label>{tr("Email")}</label>
            <input type="email" value={d.signer.email} onChange={(e) => setSigner({ email: e.target.value })} />
          </div>

          <div className="full">
            <label>{tr("Email Tujuan (untuk kirim email)")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("nama@perusahaan.com")} />
          </div>
          {canLogAkt && (
            <div className="full">
              <label className="q-ppn">
                <input type="checkbox" checked={logAkt} onChange={(e) => setLogAkt(e.target.checked)} />
                {otherSigner
                  ? `${tr("Catat ke Aktivitas Harian")} ${otherSigner.name} ${tr("sebagai \"Kirim penawaran / dokumen\" saat diunduh / dikirim")}`
                  : tr("Catat ke Aktivitas Harian saya sebagai \"Kirim penawaran / dokumen\" saat diunduh / dikirim")}
              </label>
              <div className="field-note">{tr("Satu nomor surat dicatat sekali — unduh ulang atau kirim email memperbarui catatan yang sama.")}</div>
            </div>
          )}
        </div>
      )}

      {tab === 'tampilan' && (
        <div>
          <div className="field-note" style={{ marginTop: 0 }}>
            {tr("Centang data yang ingin muncul di surat. Pilihan ini diingat di browser ini untuk surat berikutnya.")}
          </div>
          <div className="q-opts">
            {QUOTE_OPT_GROUPS.map((g) => (
              <fieldset key={g.title} className="q-opt-group">
                <legend>{g.title}</legend>
                {g.opts.map((x) => (
                  <label key={x.key} className="q-opt">
                    <input type="checkbox" checked={opts[x.key]} onChange={() => toggleOpt(x.key)} />
                    <span>
                      {x.label}
                      {x.hint && <small>{x.hint}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="full">
              <label>{tr("Alamat & telepon kantor di kop surat (opsional)")}</label>
              <textarea
                value={d.kopText}
                placeholder={tr("cth. Jl. … No. …, Jakarta 12345\nTelp. (021) … · www.…")}
                onChange={(e) => set({ kopText: e.target.value })}
                style={{ minHeight: 56 }}
              />
              <div className="field-note">{tr("Tampil di bawah nama perusahaan bila \"Logo & kop perusahaan\" dicentang.")}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                const o = defaultQuoteOpts();
                setOpts(o);
                lsSet(LS.opts, JSON.stringify(o));
              }}
            >
              {tr("Kembalikan bawaan")}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('pratinjau')}>
              {tr("Lihat pratinjau →")}
            </button>
          </div>
        </div>
      )}

      {tab === 'pratinjau' && (
        <div className="q-preview-wrap">
          {/* Konten dibangun dari data form yang di-escape di quoteHtml. */}
          <div className="q-paper" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}
      </>)}
    </Modal>
  );
}
