import { createHmac } from 'crypto';
import { fmtDate, type VrLine } from './vendor-request';

/** Token tautan unduh lampiran (WhatsApp) — tanpa login, terikat ke satu permintaan. */
export function vrToken(id: string): string {
  return createHmac('sha256', process.env.JWT_SECRET || 'tira').update(`vr:${id}`).digest('hex').slice(0, 32);
}

export function vrFileUrl(base: string, id: string, f: 'pdf' | 'xlsx'): string {
  return `${base.replace(/\/+$/, '')}/api/vendor-file/${id}?t=${vrToken(id)}&f=${f}`;
}

export function appBaseUrl(req: Request): string {
  const env = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  return `${proto}://${host}`;
}

/** Daftar item permintaan harga (PDF A4) — tanpa nama customer dan tanpa harga. */
export async function buildVrPdf(lines: VrLine[], meta: { docNo: string; tenggat: string; lokasi: string; sender: string }): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210;
  let y = 16;
  doc.setFont('helvetica', 'bold').setFontSize(14).text('PT. TIRA AUSTENITE, Tbk — Steel Division', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(10).text('Permintaan Penawaran Harga (Request for Quotation)', 14, y);
  y += 8;
  doc.setFontSize(9.5);
  [`Ref.: ${meta.docNo}`, meta.tenggat ? `Mohon dibalas paling lambat: ${fmtDate(meta.tenggat)}` : '', meta.lokasi ? `Lokasi kirim: ${meta.lokasi}` : '', `Kontak: ${meta.sender} (Purchasing)`]
    .filter(Boolean)
    .forEach((t) => {
      doc.text(t, 14, y);
      y += 5;
    });
  y += 3;
  const cols = [
    { h: 'No', w: 9 },
    { h: 'Line', w: 11 },
    { h: 'Material', w: 70 },
    { h: 'Dimensi (mm)', w: 38 },
    { h: 'Pcs', w: 13 },
    { h: 'Berat (kg)', w: 19 },
    { h: 'Harga / satuan', w: 22 },
  ];
  const head = () => {
    let x = 14;
    doc.setFillColor(27, 36, 48).rect(14, y - 4.5, W - 28, 7, 'F');
    doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(8.5);
    cols.forEach((c) => {
      doc.text(c.h, x + 1.5, y);
      x += c.w;
    });
    doc.setTextColor(0).setFont('helvetica', 'normal');
    y += 6;
  };
  head();
  lines.forEach((l) => {
    const mat = doc.splitTextToSize(l.material || '-', cols[2].w - 3) as string[];
    const dim = doc.splitTextToSize(l.dimensi || '-', cols[3].w - 3) as string[];
    const h = Math.max(mat.length, dim.length) * 4.2 + 2;
    if (y + h > 280) {
      doc.addPage();
      y = 16;
      head();
    }
    let x = 14;
    const cells = [String(l.no), l.line || '-', mat, dim, l.pcs || '-', l.beratKg || '-', ''];
    cells.forEach((c, i) => {
      doc.text(c as string | string[], x + 1.5, y);
      x += cols[i].w;
    });
    y += h;
    doc.setDrawColor(220).line(14, y - 3.5, W - 14, y - 3.5);
  });
  y += 4;
  doc.setFontSize(8.5).setTextColor(90);
  doc.text('Mohon cantumkan harga per satuan, mata uang, lead time / ketersediaan stok, negara asal dan masa berlaku penawaran.', 14, Math.min(y, 285));
  return Buffer.from(doc.output('arraybuffer'));
}

export async function buildVrXlsx(lines: VrLine[], meta: { docNo: string; tenggat: string }): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [
    ['PT. TIRA AUSTENITE, Tbk — Permintaan Penawaran Harga'],
    [`Ref.: ${meta.docNo}${meta.tenggat ? ` · Mohon dibalas paling lambat ${fmtDate(meta.tenggat)}` : ''}`],
    [],
    ['NO', 'LINE', 'MATERIAL', 'DIMENSI (MM)', 'PCS', 'BERAT (KG)', 'HARGA / SATUAN', 'MATA UANG', 'LEAD TIME', 'ASAL', 'CATATAN'],
    ...lines.map((l) => [l.no, l.line, l.material, l.dimensi, l.pcs, l.beratKg, '', '', '', '', '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [5, 6, 42, 24, 7, 10, 14, 10, 12, 10, 24].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RFQ Vendor');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function vrEmailHtml(message: string, attachNames: string[]): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const att = attachNames.length ? `<p style="margin:12px 0 0;font-size:12px;color:#5B6573">Lampiran: ${attachNames.map(esc).join(', ')}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#EEF1F4;font-family:Arial,Helvetica,sans-serif;color:#1A222B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 10px"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid #DFE5EB;border-radius:10px">
<tr><td style="padding:16px 26px;border-bottom:3px solid #C47F2C"><b style="font-size:16px">PT. TIRA AUSTENITE, Tbk</b><div style="font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#456484">STEEL DIVISION · PURCHASING</div></td></tr>
<tr><td style="padding:22px 26px;font-size:14px;line-height:1.6">${paras}${att}</td></tr>
</table></td></tr></table></body></html>`;
}
