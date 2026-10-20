/**
 * Email pengantar Surat Penawaran — satu template untuk pratinjau di layar
 * dan email yang benar-benar dikirim server, supaya yang dilihat = yang
 * diterima customer. Murni (tanpa import server / browser API).
 */
import { formatTanggalSurat, quoteTotals, rupiah, type QuoteData, type QuoteLang, type QuoteOpts } from './quotation-doc';

export interface QuoteEmailSummary {
  lang: QuoteLang;
  nomor: string;
  tanggal: string;
  perihal: string;
  kepada: string;
  items: { uraian: string; qty: number; satuan: string }[];
  total: string;
  ppnNote: string;
  berlaku: string;
  signer: { nama: string; jabatan: string; telp: string; email: string };
}

export interface QuoteEmailInput {
  message: string;
  summary: QuoteEmailSummary;
  attachments: string[];
  /** URL / cid logo; kosong = tanpa logo. */
  logoSrc: string;
}

const COMPANY = 'PT. TIRA AUSTENITE, Tbk';
const DIVISION = 'Steel Division';

const T = {
  id: {
    ringkasan: 'Ringkasan Penawaran', nomor: 'No. Surat', tanggal: 'Tanggal', perihal: 'Perihal', material: 'Material', total: 'Total Penawaran', berlaku: 'Masa Berlaku',
    lainnya: (n: number) => `+ ${n} item lainnya (lihat lampiran)`, lampiran: 'Lampiran', hormat: 'Hormat kami,', telp: 'Telp/WA',
    incl: 'sudah termasuk PPN 11%', excl: 'belum termasuk PPN 11%', subject: 'Penawaran Harga',
  },
  en: {
    ringkasan: 'Quotation Summary', nomor: 'Ref. No.', tanggal: 'Date', perihal: 'Subject', material: 'Materials', total: 'Quotation Total', berlaku: 'Validity',
    lainnya: (n: number) => `+ ${n} more item(s) (see attachment)`, lampiran: 'Attachment', hormat: 'Sincerely,', telp: 'Phone/WA',
    incl: 'including VAT 11%', excl: 'excluding VAT 11%', subject: 'Price Quotation',
  },
};

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const qtyFmt = (n: number) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** Sapaan dari kolom PIC ("Rahmat (Procurement)" -> "Rahmat"). */
export function greetName(d: QuoteData): string {
  return d.pic.replace(/\s*\(.*\)\s*$/, '').trim();
}

export function quoteEmailSummary(d: QuoteData, o: QuoteOpts): QuoteEmailSummary {
  const lang = d.lang === 'en' ? 'en' : 'id';
  const tot = quoteTotals(d, o);
  return {
    lang,
    nomor: d.nomor,
    tanggal: formatTanggalSurat(d.tanggal, lang),
    perihal: d.perihal,
    kepada: d.kepada,
    items: d.items.filter((it) => it.uraian.trim()).map((it) => ({ uraian: it.uraian.trim(), qty: Number(it.qty) || 0, satuan: it.satuan || 'pcs' })),
    total: rupiah(tot.grand).replace(/ /g, ' '),
    ppnNote: d.ppnInclude || o.ppnRinci ? T[lang].incl : T[lang].excl,
    berlaku: d.berlaku.trim(),
    signer: { ...d.signer },
  };
}

export function defaultEmailSubject(d: QuoteData): string {
  const lang = d.lang === 'en' ? 'en' : 'id';
  const first = d.items.find((it) => it.uraian.trim())?.uraian.trim() || '';
  const more = d.items.filter((it) => it.uraian.trim()).length - 1;
  const what = first ? ` — ${first}${more > 0 ? (lang === 'en' ? ` (+${more} items)` : ` (+${more} item)`) : ''}` : '';
  return `${T[lang].subject} No. ${d.nomor}${what}`.slice(0, 200);
}

export function defaultEmailMessage(d: QuoteData): string {
  const nama = greetName(d);
  if (d.lang === 'en') {
    return [
      `Dear ${nama ? `Mr./Ms. ${nama}` : 'Sir/Madam'},`,
      '',
      `Thank you for your inquiry and your trust in ${COMPANY}. Please find attached our Price Quotation No. ${d.nomor} for ${d.kepada || 'your company'}.`,
      '',
      'A summary of the quotation is shown below, and the complete quotation letter is attached as a PDF.',
      '',
      'Should you have any questions or require any adjustments, simply reply to this email or contact us directly. We look forward to hearing from you.',
    ].join('\n');
  }
  return [
    `Yth. ${nama ? `Bapak/Ibu ${nama}` : 'Bapak/Ibu'},`,
    '',
    `Terima kasih atas permintaan dan kepercayaan ${d.kepada || 'Bapak/Ibu'} kepada ${COMPANY}. Bersama email ini kami sampaikan Surat Penawaran Harga No. ${d.nomor}.`,
    '',
    'Ringkasan penawaran kami cantumkan di bawah ini, sedangkan surat penawaran lengkap terlampir dalam format PDF.',
    '',
    'Apabila ada pertanyaan atau penyesuaian yang dibutuhkan, silakan membalas email ini atau menghubungi kami langsung. Kami menantikan kabar baik dari Bapak/Ibu.',
  ].join('\n');
}

/** Teks polos (untuk klien email tanpa HTML & aplikasi email biasa). */
export function quoteEmailText(input: QuoteEmailInput): string {
  const s = input.summary;
  const t = T[s.lang];
  const lines = [
    input.message.trim(),
    '',
    `— ${t.ringkasan} —`,
    `${t.nomor}: ${s.nomor}`,
    `${t.tanggal}: ${s.tanggal}`,
    `${t.perihal}: ${s.perihal}`,
    `${t.material}:`,
    ...s.items.slice(0, 8).map((it) => `  • ${it.uraian} — ${qtyFmt(it.qty)} ${it.satuan}`),
    ...(s.items.length > 8 ? [`  ${t.lainnya(s.items.length - 8)}`] : []),
    `${t.total}: ${s.total} (${s.ppnNote})`,
    ...(s.berlaku ? [`${t.berlaku}: ${s.berlaku}`] : []),
    ...(input.attachments.length ? ['', `${t.lampiran}: ${input.attachments.join(', ')}`] : []),
    '',
    t.hormat,
    s.signer.nama,
    ...(s.signer.jabatan ? [s.signer.jabatan] : []),
    `${COMPANY} – ${DIVISION}`,
    ...(s.signer.telp ? [`${t.telp}: ${s.signer.telp}`] : []),
    ...(s.signer.email ? [`Email: ${s.signer.email}`] : []),
  ];
  return lines.join('\n');
}

/** Email HTML (tabel + gaya inline, aman untuk Gmail/Outlook). */
export function quoteEmailHtml(input: QuoteEmailInput): string {
  const s = input.summary;
  const t = T[s.lang];
  const paras = input.message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const shown = s.items.slice(0, 6);
  const itemsHtml =
    shown
      .map(
        (it) =>
          `<tr><td style="padding:3px 0;vertical-align:top;color:#1A222B">${esc(it.uraian)}</td><td style="padding:3px 0 3px 12px;vertical-align:top;white-space:nowrap;text-align:right;color:#5B6573">${esc(qtyFmt(it.qty))} ${esc(it.satuan)}</td></tr>`,
      )
      .join('') + (s.items.length > shown.length ? `<tr><td colspan="2" style="padding:3px 0;color:#5B6573;font-style:italic">${esc(t.lainnya(s.items.length - shown.length))}</td></tr>` : '');
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 16px;width:120px;color:#5B6573;font-size:12px;vertical-align:top;border-top:1px solid #EDF1F5">${esc(k)}</td><td style="padding:7px 16px;font-size:13px;color:#1A222B;vertical-align:top;border-top:1px solid #EDF1F5">${v}</td></tr>`;
  const attach = input.attachments
    .map((f) => {
      const ext = (f.split('.').pop() || '').toUpperCase();
      const color = ext === 'PDF' ? '#B3392F' : '#2B5797';
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="display:inline-table;margin:0 8px 8px 0;border:1px solid #DFE5EB;border-radius:6px"><tr><td style="background:${color};color:#fff;font-size:10px;font-weight:bold;padding:6px 7px;border-radius:5px 0 0 5px">${esc(ext)}</td><td style="padding:6px 10px;font-size:12px;color:#1A222B">${esc(f)}</td></tr></table>`;
    })
    .join('');
  const sg = s.signer;
  const logo = input.logoSrc ? `<img src="${esc(input.logoSrc)}" alt="TIRA" height="40" style="display:block;height:40px;border:0">` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.perihal)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F4;font-family:Arial,Helvetica,sans-serif;color:#1A222B">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EEF1F4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid #DFE5EB;border-radius:10px;overflow:hidden">
  <tr><td style="padding:18px 28px;border-bottom:3px solid #C47F2C">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      ${logo ? `<td style="padding-right:14px;vertical-align:middle">${logo}</td>` : ''}
      <td style="vertical-align:middle"><div style="font-size:17px;font-weight:bold;color:#1A222B">${COMPANY}</div><div style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#456484;text-transform:uppercase">${DIVISION}</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 28px 6px;font-size:14px;line-height:1.6">${paras}</td></tr>
  <tr><td style="padding:0 28px 6px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #DFE5EB;border-radius:8px;overflow:hidden">
      <tr><td colspan="2" style="background:#F4F6F8;padding:9px 16px;font-size:11px;font-weight:bold;letter-spacing:1.2px;color:#456484;text-transform:uppercase">${esc(t.ringkasan)}</td></tr>
      ${row(t.nomor, `<b>${esc(s.nomor)}</b>`)}
      ${row(t.tanggal, esc(s.tanggal))}
      ${row(t.perihal, esc(s.perihal))}
      ${row(t.material, `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">${itemsHtml}</table>`)}
      <tr><td style="padding:12px 16px;width:120px;color:#5B6573;font-size:12px;vertical-align:middle;border-top:1px solid #EDF1F5;background:#FBF6EE">${esc(t.total)}</td><td style="padding:12px 16px;vertical-align:middle;border-top:1px solid #EDF1F5;background:#FBF6EE"><span style="font-size:20px;font-weight:bold;color:#A8661C">${esc(s.total)}</span><br><span style="font-size:11px;color:#5B6573">${esc(s.ppnNote)}</span></td></tr>
      ${s.berlaku ? row(t.berlaku, esc(s.berlaku)) : ''}
    </table>
  </td></tr>
  ${input.attachments.length ? `<tr><td style="padding:16px 28px 0"><div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#5B6573;text-transform:uppercase;margin-bottom:8px">${esc(t.lampiran)}</div>${attach}</td></tr>` : ''}
  <tr><td style="padding:18px 28px 26px;font-size:14px;line-height:1.55">
    <div>${esc(t.hormat)}</div>
    <div style="margin-top:14px;font-weight:bold;font-size:15px">${esc(sg.nama)}</div>
    ${sg.jabatan ? `<div style="color:#5B6573">${esc(sg.jabatan)}</div>` : ''}
    <div style="color:#456484;font-weight:bold">${COMPANY} &middot; ${DIVISION}</div>
    <div style="font-size:12.5px;color:#5B6573;margin-top:4px">${[sg.telp && `${esc(t.telp)}: ${esc(sg.telp)}`, sg.email && `<a href="mailto:${esc(sg.email)}" style="color:#456484;text-decoration:none">${esc(sg.email)}</a>`].filter(Boolean).join(' &nbsp;|&nbsp; ')}</div>
  </td></tr>
  <tr><td style="background:#1A222B;color:#9FB0C2;font-size:11px;padding:12px 28px">${COMPANY} &middot; ${DIVISION}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
