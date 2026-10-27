/**
 * Email bebas dari CRM (menu "Kirim Email", Admin & GM): pengumuman ke user
 * CRM atau email ke customer. Pure — dipakai server untuk mengirim dan layar
 * untuk pratinjau, supaya yang dilihat pengirim sama dengan yang diterima.
 */

export type ComposeMode = 'internal' | 'customer';

export interface ComposeEmailInput {
  mode: ComposeMode;
  message: string;
  /** Nama file lampiran (ditampilkan sebagai daftar). */
  attachments: string[];
  /** Sapaan pembuka opsional, cth. "Yth. Bapak Rahmat" (customer) / "Halo Andi" (internal). */
  greeting?: string;
  signer: { nama: string; jabatan: string; email: string };
  /** 'cid:tira-logo' saat dikirim, '/logo.png' di pratinjau, '' = tanpa logo. */
  logoSrc: string;
}

const COMPANY = 'PT. TIRA AUSTENITE, Tbk';
const DIVISION = 'Steel Division';
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function composeEmailHtml(input: ComposeEmailInput): string {
  const paras = input.message
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const greet = input.greeting ? `<p style="margin:0 0 14px">${esc(input.greeting)},</p>` : '';
  const attach = input.attachments
    .map((f) => {
      const ext = (f.split('.').pop() || '').toUpperCase();
      const color = ext === 'PDF' ? '#B3392F' : ext === 'XLSX' || ext === 'XLS' ? '#1F7A45' : ext === 'DOCX' || ext === 'DOC' ? '#2B5797' : '#5B6573';
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="display:inline-table;margin:0 8px 8px 0;border:1px solid #DFE5EB;border-radius:6px"><tr><td style="background:${color};color:#fff;font-size:10px;font-weight:bold;padding:6px 7px;border-radius:5px 0 0 5px">${esc(ext)}</td><td style="padding:6px 10px;font-size:12px;color:#1A222B">${esc(f)}</td></tr></table>`;
    })
    .join('');
  const sg = input.signer;
  const logo = input.logoSrc ? `<img src="${esc(input.logoSrc)}" alt="TIRA" height="40" style="display:block;height:40px;border:0">` : '';
  const badge =
    input.mode === 'internal'
      ? `<div style="display:inline-block;font-size:11px;font-weight:bold;letter-spacing:1px;padding:3px 10px;border-radius:10px;background:#E7EEF3;color:#24496B;margin-bottom:14px">PENGUMUMAN · CRM TIRA</div>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF1F4;font-family:Arial,Helvetica,sans-serif;color:#1A222B">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EEF1F4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid #DFE5EB;border-radius:10px;overflow:hidden">
  <tr><td style="padding:18px 28px;border-bottom:3px solid #C47F2C">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      ${logo ? `<td style="padding-right:14px;vertical-align:middle">${logo}</td>` : ''}
      <td style="vertical-align:middle"><div style="font-size:17px;font-weight:bold;color:#1A222B">${COMPANY}</div><div style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#456484;text-transform:uppercase">${DIVISION}</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 28px 6px;font-size:14px;line-height:1.6">${badge}${greet}${paras}</td></tr>
  ${input.attachments.length ? `<tr><td style="padding:6px 28px 0"><div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#5B6573;text-transform:uppercase;margin-bottom:8px">Lampiran</div>${attach}</td></tr>` : ''}
  <tr><td style="padding:18px 28px 26px;font-size:14px;line-height:1.55">
    <div>Salam,</div>
    <div style="margin-top:14px;font-weight:bold;font-size:15px">${esc(sg.nama)}</div>
    ${sg.jabatan ? `<div style="color:#5B6573">${esc(sg.jabatan)}</div>` : ''}
    <div style="color:#456484;font-weight:bold">${COMPANY} &middot; ${DIVISION}</div>
    ${sg.email ? `<div style="font-size:12.5px;margin-top:4px"><a href="mailto:${esc(sg.email)}" style="color:#456484;text-decoration:none">${esc(sg.email)}</a></div>` : ''}
  </td></tr>
  <tr><td style="background:#1A222B;color:#9FB0C2;font-size:11px;padding:12px 28px">${COMPANY} &middot; ${DIVISION}${input.mode === 'internal' ? ' &middot; dikirim dari CRM TIRA' : ''}</td></tr>
</table>
</td></tr></table></body></html>`;
}

export function composeEmailText(input: ComposeEmailInput): string {
  const sg = input.signer;
  return [
    input.greeting ? `${input.greeting},` : '',
    input.message.trim(),
    input.attachments.length ? `Lampiran: ${input.attachments.join(', ')}` : '',
    `Salam,\n${sg.nama}${sg.jabatan ? `\n${sg.jabatan}` : ''}\n${COMPANY} · ${DIVISION}${sg.email ? `\n${sg.email}` : ''}`,
  ]
    .filter(Boolean)
    .join('\r\n\r\n');
}

/** Siapa yang boleh memakai menu Kirim Email. */
export function canComposeMail(role: string | null | undefined): boolean {
  return role === 'gm' || role === 'vp' || role === 'admin';
}

export const MAIL_MAX_RECIPIENTS = 300;
export const MAIL_MAX_ATTACH_BYTES = 10 * 1024 * 1024;
export const MAIL_ATTACH_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
