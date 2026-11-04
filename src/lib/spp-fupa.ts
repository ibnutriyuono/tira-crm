import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { num } from './format';
import { SPP_PPN_DEFAULT, SPP_ROWS_PER_PAGE, lineJumlah, sppPages, sppTotals, type SppDoc, type SppLine } from './spp-doc';
import type { RfqItem } from './types';

/**
 * SPP (Surat Penerimaan Pesanan) FUP A — file Excel dari form resmi
 * (src/templates/spp-fup-a.xlsx, diisi langsung di XML-nya sehingga logo,
 * garis dan merge tetap utuh) dan file Word dengan susunan yang sama.
 * Lebih dari 20 item -> halaman berikutnya (sheet "Hal 2", dst. / tabel
 * Word yang bersambung dengan judul kolom berulang).
 */

const FIRST_ITEM_ROW = 23;
const KET_CHARS_PER_LINE = 58; // lebar kolom KETERANGAN (H:P) pada huruf 10 pt

let templateCache: Buffer | null = null;
async function template(): Promise<Buffer> {
  if (!templateCache) templateCache = await readFile(path.join(process.cwd(), 'src', 'templates', 'spp-fup-a.xlsx'));
  return templateCache;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

/** Excel serial date (1900 system) dari YYYY-MM-DD. */
function serial(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function tglText(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : s || '';
}

// ---------------------------------------------------------------------------
// Excel

type CellValue = { str: string } | { num: number } | { formula: string; value?: number } | { blank: true };

function setCell(xml: string, ref: string, v: CellValue, style?: number): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`Sel ${ref} tidak ada di template SPP`);
  let attrs = m[1].replace(/\s+t="[^"]*"/, '');
  if (style != null) attrs = attrs.replace(/\s+s="\d+"/, '') + ` s="${style}"`;
  const body =
    'blank' in v
      ? '/>'
      : 'str' in v
        ? ` t="inlineStr"><is><t xml:space="preserve">${esc(v.str)}</t></is></c>`
        : 'num' in v
          ? `><v>${v.num}</v></c>`
          : `><f>${esc(v.formula)}</f>${v.value != null ? `<v>${v.value}</v>` : ''}</c>`;
  return xml.slice(0, m.index) + `<c r="${ref}"${attrs}${body}` + xml.slice(m.index + m[0].length);
}

function addMerge(xml: string, ref: string): string {
  if (xml.includes(`<mergeCell ref="${ref}"/>`)) return xml;
  return xml.replace(/<mergeCells count="(\d+)">/, (_m, n: string) => `<mergeCells count="${Number(n) + 1}"><mergeCell ref="${ref}"/>`);
}

function setRowHeight(xml: string, r: number, ht: number): string {
  return xml.replace(new RegExp(`<row r="${r}"([^>]*?)>`), (_m, a: string) => `<row r="${r}"${a.replace(/\s+ht="[^"]*"/, '').replace(/\s+customHeight="[^"]*"/, '')} ht="${ht}" customHeight="1">`);
}

/** Tambah xf turunan `base` di styles.xml (alignment / numFmt) — index baru. */
function addXf(styles: { xml: string }, base: number, opt: { wrap?: boolean; vTop?: boolean; vCenter?: boolean; numFmtId?: number; hLeft?: boolean }): number {
  const open = styles.xml.indexOf('<cellXfs');
  const close = styles.xml.indexOf('</cellXfs>', open);
  const block = styles.xml.slice(open, close);
  const xfs = block.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const src = xfs[base];
  if (!src) return base;
  let xf = src;
  if (opt.wrap || opt.vTop || opt.vCenter || opt.hLeft) {
    const old = /<alignment\b([^>]*)\/>/.exec(xf)?.[1] || '';
    xf = xf.replace(/<alignment\b[^>]*\/>/, '');
    let a = old.replace(/\s*wrapText="[^"]*"/, '').replace(/\s*vertical="[^"]*"/, '');
    if (opt.hLeft) a = a.replace(/\s*horizontal="[^"]*"/, '') + ' horizontal="left" indent="0"';
    if (opt.wrap) a += ' wrapText="1"';
    if (opt.vTop) a += ' vertical="top"';
    if (opt.vCenter) a += ' vertical="center"';
    const align = `<alignment${a}/>`;
    xf = xf.endsWith('/>') ? xf.replace(/\/>$/, `>${align}</xf>`) : xf.replace(/<\/xf>$/, `${align}</xf>`);
    xf = /applyAlignment=/.test(xf) ? xf.replace(/applyAlignment="\d"/, 'applyAlignment="1"') : xf.replace('<xf ', '<xf applyAlignment="1" ');
  }
  if (opt.numFmtId != null) {
    xf = xf.replace(/numFmtId="\d+"/, `numFmtId="${opt.numFmtId}"`);
    xf = /applyNumberFormat=/.test(xf) ? xf.replace(/applyNumberFormat="\d"/, 'applyNumberFormat="1"') : xf.replace('<xf ', '<xf applyNumberFormat="1" ');
  }
  const idx = xfs.length;
  styles.xml = styles.xml.slice(0, open) + block.replace(/count="\d+"/, `count="${idx + 1}"`) + xf + styles.xml.slice(close);
  return idx;
}

interface Styles {
  nameWrap: number;
  ketWrap: number;
  qtyInt: number;
  qtyDec: number;
  instr: number;
}

function fillPage(xml0: string, d: SppDoc, lines: SppLine[], page: number, pages: number, sheetNames: string[], st: Styles): string {
  let xml = xml0;
  const last = page === pages - 1;
  const tot = sppTotals(d);

  xml = setCell(xml, 'M4', { str: `FUP- ${d.jenis}` });
  xml = setCell(xml, 'M6', { str: `Nomor: ${d.noFupa}` });
  xml = setCell(xml, 'C11', { str: pages > 1 ? `SURAT PENERIMAAN PESANAN  (Hal. ${page + 1}/${pages})` : 'SURAT PENERIMAAN PESANAN' });

  // SPP: tiga kotak X3..Z3 (diisi dari kanan bila nomornya pendek).
  const spp = d.noSpp.replace(/\s+/g, '');
  if (spp) {
    if (spp.length <= 3) spp.padStart(3, ' ').split('').forEach((ch, i) => ch.trim() && (xml = setCell(xml, `${'XYZ'[i]}3`, { str: ch })));
    else xml = setCell(xml, 'X3', { str: spp });
  }
  // TGL: enam kotak R4..W4 = D D M M Y Y.
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.tgl || '');
  if (t) `${t[3]}${t[2]}${t[1].slice(2)}`.split('').forEach((ch, i) => (xml = setCell(xml, `${'RSTUVW'[i]}4`, { str: ch })));

  d.cabang.slice(0, 12).split('').forEach((ch, i) => (xml = setCell(xml, `${'CDEFGHIJKLMN'[i]}14`, { str: ch })));
  if (d.disetujuiLangganan) xml = setCell(xml, 'Q14', { str: d.disetujuiLangganan });
  xml = setCell(xml, 'O16', { str: `NAMA : ${d.customer}` }, st.nameWrap);
  // NPWP: satu karakter per kotak D16..N16 (angka saja); lebih panjang -> teks utuh.
  const npwp = d.npwp.replace(/[^0-9]/g, '');
  if (npwp && npwp.length <= 11) npwp.split('').forEach((ch, i) => (xml = setCell(xml, `${'DEFGHIJKLMN'[i]}16`, { str: ch })));
  else if (d.npwp) {
    // NPWP lengkap (15/16 digit + tanda baca): kotak D16..N16 digabung jadi satu isian.
    xml = setCell(xml, 'D16', { str: d.npwp });
    xml = addMerge(xml, 'D16:N16');
  }
  if (d.bumn === 'ya') xml = setCell(xml, 'H17', { str: 'X' });
  if (d.bumn === 'tidak') xml = setCell(xml, 'K17', { str: 'X' });
  if (d.noPo) xml = setCell(xml, 'S16', { str: d.noPo });
  if (d.noOe) xml = setCell(xml, 'S17', { str: d.noOe });

  for (let i = 0; i < SPP_ROWS_PER_PAGE; i++) {
    const r = FIRST_ITEM_ROW + i;
    const l = lines[i];
    if (!l) {
      xml = setCell(xml, `U${r}`, { blank: true });
      continue;
    }
    if (l.qty) xml = setCell(xml, `C${r}`, { num: Math.round(l.qty * 100) / 100 }, Number.isInteger(l.qty) ? st.qtyInt : st.qtyDec);
    if (l.satuan) xml = setCell(xml, `E${r}`, { str: l.satuan });
    xml = setCell(xml, `H${r}`, { str: l.keterangan }, st.ketWrap);
    if (l.harga) xml = setCell(xml, `Q${r}`, { num: l.harga });
    xml = setCell(xml, `U${r}`, { formula: `Q${r}*C${r}`, value: lineJumlah(l) });
    const nLines = Math.max(1, Math.ceil(l.keterangan.length / KET_CHARS_PER_LINE));
    if (nLines > 1) xml = setRowHeight(xml, r, Math.min(60, 4 + nLines * 13));
  }

  const pageSum = Math.round(lines.reduce((s, l) => s + lineJumlah(l), 0) * 100) / 100;
  if (!last) {
    xml = setCell(xml, 'Q43', { str: `JUMLAH HAL. ${page + 1}` });
    xml = setCell(xml, 'U43', { formula: 'SUM(U23:Z42)', value: pageSum });
    xml = setCell(xml, 'Q44', { str: `Bersambung ke hal. ${page + 2}` });
    xml = setCell(xml, 'U44', { blank: true });
    xml = setCell(xml, 'Q45', { str: '' });
    xml = setCell(xml, 'U45', { blank: true });
  } else {
    const ranges = pages > 1 ? sheetNames.map((n) => `'${n}'!U23:Z42`).join(',') : 'U23:Z42';
    xml = setCell(xml, 'U43', { formula: `SUM(${ranges})`, value: tot.sub });
    xml = setCell(xml, 'Q44', { str: `PPN ${d.ppn} %` });
    xml = setCell(xml, 'U44', { formula: `ROUND(U43*${d.ppn}/100,2)`, value: tot.ppn });
    xml = setCell(xml, 'U45', { formula: 'SUM(U43:Z44)', value: tot.grand });
  }

  const instr = d.instruksi.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (instr.length) {
    xml = setCell(xml, 'C44', { str: instr.slice(0, Math.ceil(instr.length / 2)).join(' · ') }, st.instr);
    if (instr.length > 1) xml = setCell(xml, 'C45', { str: instr.slice(Math.ceil(instr.length / 2)).join(' · ') }, st.instr);
  }

  const kirim = serial(d.tglKirim);
  if (kirim != null) xml = setCell(xml, 'C47', { num: kirim });
  else if (d.tglKirim) xml = setCell(xml, 'C47', { str: d.tglKirim });
  if (d.jangkaBayar) xml = setCell(xml, 'G47', { str: d.jangkaBayar });

  const sign = (nameRef: string, dateRef: string, nama: string, tgl: string) => {
    if (nama) xml = setCell(xml, nameRef, { str: nama });
    if (tgl) xml = setCell(xml, dateRef, { str: tglText(tgl) });
  };
  sign('C53', 'H53', d.dibuatOleh, d.tglDibuat);
  sign('M53', 'P53', d.diperiksaOleh, d.tglDiperiksa);
  sign('Q53', 'V53', d.disetujuiOleh, d.tglDisetujui);

  // Cetak: A4 tegak, satu halaman per sheet, margin aman untuk printer.
  xml = xml.replace(/<pageMargins[^>]*\/>/, '<pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0" footer="0"/>');
  xml = xml.replace(/<pageSetup[^>]*\/>/, '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>');
  xml = /<sheetPr\b/.test(xml)
    ? xml.replace(/<sheetPr\b([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>')
    : xml.replace(/<dimension\b/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
  if (page > 0) xml = xml.replace(/\s*tabSelected="1"/, '');
  return xml;
}

export async function buildSppXlsx(d: SppDoc): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await template());
  const base = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const styles = { xml: await zip.file('xl/styles.xml')!.async('string') };
  const st: Styles = {
    nameWrap: addXf(styles, 79, { wrap: true, vTop: true }),
    ketWrap: addXf(styles, 102, { wrap: true, vCenter: true }),
    qtyInt: addXf(styles, 99, { numFmtId: 3, vCenter: true }),
    qtyDec: addXf(styles, 99, { numFmtId: 4, vCenter: true }),
    instr: addXf(styles, 119, { wrap: true, vCenter: true }),
  };

  const pages = sppPages(d);
  const names = pages.length > 1 ? pages.map((_, i) => `Hal ${i + 1}`) : ['SPP'];
  let wb = await zip.file('xl/workbook.xml')!.async('string');
  let wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  let ct = await zip.file('[Content_Types].xml')!.async('string');
  const sheetRels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
  const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string');
  const drawingRels = await zip.file('xl/drawings/_rels/drawing1.xml.rels')!.async('string');

  const sheetsXml: string[] = [];
  const defNames: string[] = [];
  pages.forEach((lines, i) => {
    const n = i + 1;
    zip.file(`xl/worksheets/sheet${n}.xml`, fillPage(base, d, lines, i, pages.length, names, st));
    // Halaman berikutnya: salinan sheet + gambar logonya sendiri.
    if (n > 1) {
      zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`, sheetRels.replace('../drawings/drawing1.xml', `../drawings/drawing${n}.xml`).replace(/<Relationship [^>]*printerSettings[^>]*\/>/, ''));
      zip.file(`xl/drawings/drawing${n}.xml`, drawing);
      zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, drawingRels);
      wbRels = wbRels.replace('</Relationships>', `<Relationship Id="rIdSpp${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`);
      ct = ct.replace('</Types>', `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    sheetsXml.push(`<sheet name="${esc(names[i])}" sheetId="${n}" r:id="${n === 1 ? 'rId1' : `rIdSpp${n}`}"/>`);
    defNames.push(`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${esc(names[i])}'!$B$2:$AA$56</definedName>`);
  });
  wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsXml.join('')}</sheets>`);
  wb = wb.replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${defNames.join('')}</definedNames>`);
  wb = /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b([^>]*?)\/>/, (_m, a: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`) : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');

  // Rumus dihitung ulang saat dibuka (calcChain lama dibuang); nilai awal sudah terisi.
  zip.remove('xl/calcChain.xml');
  ct = ct.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, '');
  wbRels = wbRels.replace(/<Relationship [^>]*Target="calcChain.xml"\/>/, '');
  // Daftar nama sheet di docProps/app.xml ikut disesuaikan.
  let app = (await zip.file('docProps/app.xml')?.async('string')) || '';
  if (app) {
    app = app
      .replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>`)
      .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((n) => `<vt:lpstr>${esc(n)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`);
    zip.file('docProps/app.xml', app);
  }
  zip.file('xl/workbook.xml', wb);
  zip.file('xl/_rels/workbook.xml.rels', wbRels);
  zip.file('[Content_Types].xml', ct);
  zip.file('xl/styles.xml', styles.xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// Word (A4, bisa diedit)

let logoCache: Buffer | null = null;
async function logoJpeg(): Promise<Buffer | null> {
  if (logoCache) return logoCache;
  const zip = await JSZip.loadAsync(await template());
  const f = zip.file('xl/media/image1.jpeg');
  logoCache = f ? await f.async('nodebuffer') : null;
  return logoCache;
}

const rp = (n: number) => (n ? `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}` : '');
const qtyTxt = (n: number) => (n ? n.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '');

export async function buildSppDocx(d: SppDoc): Promise<Buffer> {
  const D = await import('docx');
  const { AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, ShadingType } = D;
  const FONT = 'Arial';
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 18, bold: o.bold, color: o.color });
  const para = (text: string | InstanceType<typeof TextRun>[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; size?: number; after?: number } = {}) =>
    new Paragraph({ alignment: o.align, spacing: { before: 0, after: o.after ?? 0 }, children: typeof text === 'string' ? [run(text, { bold: o.bold, size: o.size })] : text });
  const line = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const all = { top: line, bottom: line, left: line, right: line };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const cell = (children: InstanceType<typeof Paragraph>[], w: number, o: { span?: number; shade?: boolean; borders?: typeof all | typeof noBorders; vAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign] } = {}) =>
    new TableCell({
      children,
      width: { size: w, type: WidthType.DXA },
      columnSpan: o.span,
      borders: o.borders ?? all,
      verticalAlign: (o.vAlign ?? VerticalAlign.CENTER) as never,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F4' } : undefined,
    });
  const W = 10466; // lebar isi A4 (margin 0,5")
  const tot = sppTotals(d);
  const logo = await logoJpeg();

  // Kepala: logo + alamat | FUP / Nomor | SPP & TGL
  const head = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [4300, 3466, 2700],
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows: [
      new TableRow({
        children: [
          cell(
            [
              logo ? new Paragraph({ spacing: { after: 100 }, children: [new ImageRun({ type: 'jpg', data: logo, transformation: { width: 210, height: 60 } })] }) : para('PT TIRA AUSTENITE Tbk', { bold: true, size: 28 }),
              para('ALAMAT : JL. PULO AYANG R. 1 KIP. JAK-TIM', { size: 15 }),
              para('TEL NO. (021) 4602594  ·  FAX NO. (021) 4602593', { size: 15 }),
            ],
            4300,
            { borders: noBorders, vAlign: VerticalAlign.TOP },
          ),
          cell([para(`FUP- ${d.jenis}`, { bold: true, size: 26, align: AlignmentType.CENTER, after: 80 }), para(`Nomor: ${d.noFupa}`, { bold: true, size: 24, align: AlignmentType.CENTER })], 3466, { borders: noBorders }),
          cell([para([run('SPP : ', { size: 16 }), run(d.noSpp || '……', { bold: true })], { after: 60 }), para([run('TGL : ', { size: 16 }), run(tglText(d.tgl), { bold: true })])], 2700, { borders: noBorders }),
        ],
      }),
    ],
  });

  const info = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2600, 4566, 3300],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          cell([para('CABANG/WILAYAH', { size: 14 }), para(d.cabang, { bold: true })], 2600),
          cell([para('L A N G G A N A N  —  NAMA', { size: 14 }), para(d.customer, { bold: true, size: 20 })], 4566),
          cell([para('DISETUJUI LANGGANAN', { size: 14 }), para(d.disetujuiLangganan)], 3300),
        ],
      }),
      new TableRow({
        children: [
          cell([para([run('NPWP : ', { size: 14 }), run(d.npwp)])], 2600),
          cell([para([run('BUMN : ', { size: 14 }), run(d.bumn === 'ya' ? '☒ YA   ☐ TIDAK' : d.bumn === 'tidak' ? '☐ YA   ☒ TIDAK' : '☐ YA   ☐ TIDAK')])], 4566),
          cell([para([run('NO PO : ', { bold: true, size: 16 }), run(d.noPo, { bold: true })]), para([run('NO OE : ', { bold: true, size: 16 }), run(d.noOe)])], 3300),
        ],
      }),
    ],
  });

  const cols = [1150, 950, 4466, 1650, 2250];
  const th = (t: string, i: number) => cell([para(t, { bold: true, size: 15, align: AlignmentType.CENTER })], cols[i], { shade: true });
  const lines = sppPages(d).flat();
  const blank = Math.max(0, 8 - lines.length); // beberapa baris kosong untuk isian manual
  const itemRows = [
    ...lines.map((l) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell([para(qtyTxt(l.qty), { align: AlignmentType.RIGHT })], cols[0]),
          cell([para(l.satuan, { align: AlignmentType.CENTER })], cols[1]),
          cell([para(l.keterangan)], cols[2]),
          cell([para(rp(l.harga), { align: AlignmentType.RIGHT })], cols[3]),
          cell([para(rp(lineJumlah(l)), { align: AlignmentType.RIGHT })], cols[4]),
        ],
      }),
    ),
    ...Array.from({ length: blank }, () => new TableRow({ height: { value: 340, rule: 'atLeast' as const }, children: cols.map((w) => cell([para('')], w)) })),
  ];
  const totalRow = (label: string, value: string, bold = false) =>
    new TableRow({
      cantSplit: true,
      children: [cell([para('')], cols[0] + cols[1] + cols[2], { span: 3, borders: { ...all, top: line } }), cell([para(label, { bold, align: AlignmentType.CENTER })], cols[3]), cell([para(value, { bold, align: AlignmentType.RIGHT })], cols[4])],
    });
  const items = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: cols,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: [th('KUANTITAS', 0), th('SATUAN UKURAN', 1), th('KETERANGAN', 2), th('HARGA SATUAN / KG', 3), th('JUMLAH (Rp)', 4)] }),
      ...itemRows,
      totalRow('SUB TOTAL', rp(tot.sub), true),
      totalRow(`PPN ${d.ppn} %`, rp(tot.ppn)),
      totalRow('GRAND TOTAL', rp(tot.grand), true),
    ],
  });

  const instr = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ children: [cell([para('INSTRUKSI KHUSUS', { size: 14 }), ...(d.instruksi || '').split(/\n+/).map((s) => para(s.trim(), { bold: true }))], W, {})] }),
    ],
  });
  const kirim = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3000, 4000, 3466],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          cell([para('TGL PENGIRIMAN', { size: 14, align: AlignmentType.CENTER }), para(isYmd(d.tglKirim) ? tglText(d.tglKirim) : d.tglKirim, { align: AlignmentType.CENTER, bold: true })], 3000),
          cell([para('JANGKA WAKTU PEMBAYARAN', { size: 14, align: AlignmentType.CENTER }), para(d.jangkaBayar, { align: AlignmentType.CENTER, bold: true })], 4000),
          cell([para('')], 3466, { borders: noBorders }),
        ],
      }),
    ],
  });
  const sigW = Math.floor(W / 3);
  const sigCol = (title: string, nama: string, tgl: string) =>
    cell([para(title, { bold: true, size: 15, align: AlignmentType.CENTER, after: 60 }), para('Nama dan tanda tangan', { size: 14, align: AlignmentType.CENTER, after: 700 }), para(nama || '(………………………)', { align: AlignmentType.CENTER, bold: !!nama }), para(`Tanggal: ${tglText(tgl)}`, { size: 15, align: AlignmentType.CENTER })], sigW);
  const sign = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [sigW, sigW, sigW],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: [sigCol('DIBUAT OLEH', d.dibuatOleh, d.tglDibuat), sigCol('DIPERIKSA OLEH', d.diperiksaOleh, d.tglDiperiksa), sigCol('DISETUJUI OLEH', d.disetujuiOleh, d.tglDisetujui)] })],
  });

  const gap = (after = 120) => new Paragraph({ spacing: { before: 0, after }, children: [] });
  const doc = new Document({
    creator: 'CRM TIRA',
    title: `SPP ${d.noFupa}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 640, bottom: 640, left: 720, right: 720, footer: 300 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`SPP ${d.noFupa}  ·  Hal. `, { size: 14, color: '666666' }), new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '666666', font: FONT }), run(' / ', { size: 14, color: '666666' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: '666666', font: FONT })] })],
          }),
        },
        children: [
          head,
          gap(80),
          para('SURAT PENERIMAAN PESANAN', { bold: true, size: 26, align: AlignmentType.CENTER, after: 120 }),
          info,
          gap(80),
          para('Telah diterima pesanan sesuai dengan kondisi dan permintaan sebagai berikut :', { size: 15, after: 60 }),
          items,
          gap(100),
          instr,
          gap(100),
          kirim,
          gap(200),
          sign,
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------------------
// Isi awal dari data CRM.

type ProspectMat = { uraian?: string; qty?: number; beratPc?: number; hargaKg?: number; harga?: number; hargaUnit?: number; satuan?: string };
const normTxt = (s: unknown) => String(s || '').toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, ' ').trim();

/**
 * Satu baris SPP per item FUP A. Harga dari material prospek yang sama
 * (dicocokkan lewat uraian, lalu urutan). Kuantitas dalam KG bila beratnya
 * ada (harga per kg); fabrikasi / tanpa berat memakai qty & satuan item.
 */
export function sppLines(items: (RfqItem & { satuan?: string })[], mats: ProspectMat[]): SppLine[] {
  const used = new Set<number>();
  const pick = (it: RfqItem, i: number): ProspectMat | null => {
    const key = normTxt(it.material);
    let j = mats.findIndex((m, k) => !used.has(k) && key && normTxt(m.uraian) === key);
    if (j < 0 && mats.length === items.length && !used.has(i)) j = i;
    if (j < 0) return null;
    used.add(j);
    return mats[j];
  };
  return items
    .filter((it) => String(it.material || '').trim())
    .map((it, i) => {
      const m = pick(it, i);
      const pcs = num(it.pcs);
      const kg = num(it.berat) || (m ? pcs * num(m.beratPc) : 0);
      const fab = !kg;
      const satuanItem = String(it.satuan || it.uom || m?.satuan || (fab ? 'UNIT' : 'PCS')).toUpperCase();
      const ket = `${String(it.material).trim()}${!fab && pcs ? ` — ${pcs} ${satuanItem === 'KG' ? 'PCS' : satuanItem}` : ''}`;
      return fab
        ? { qty: pcs, satuan: satuanItem, keterangan: ket, harga: m ? num(m.hargaUnit) || num(m.harga) : 0 }
        : { qty: Math.round(kg * 100) / 100, satuan: 'KG', keterangan: ket, harga: m ? num(m.hargaKg) : 0 };
    });
}

export function defaultSppDoc(
  fupa: { noFupa: string | null; tglFupa: string | null; cabang: string | null; customer: string | null; requestedBy: string | null; catatan: string | null; sourceNoRfq: string | null; items: unknown; createdAt: Date },
  prospect: { noPo: string | null; tglDelivery: string | null; materials: unknown; status: number } | null,
): SppDoc {
  const items = (Array.isArray(fupa.items) ? fupa.items : []) as (RfqItem & { satuan?: string })[];
  const lines = sppLines(items, (Array.isArray(prospect?.materials) ? prospect!.materials : []) as ProspectMat[]);
  const est = items.map((it) => String(it.estimasi || '')).filter(isYmd).sort()[0] || '';
  const janji = prospect && Number(prospect.status) === 4 && isYmd(prospect.tglDelivery || '') ? prospect.tglDelivery! : '';
  const tgl = isYmd(fupa.tglFupa || '') ? fupa.tglFupa! : fupa.createdAt.toISOString().slice(0, 10);
  const instruksi = [String(fupa.catatan || '').trim(), fupa.sourceNoRfq ? `Ref. RFQ ${fupa.sourceNoRfq}` : ''].filter(Boolean).join('\n');
  return {
    jenis: 'A',
    noSpp: '',
    noFupa: fupa.noFupa || '',
    tgl,
    cabang: (fupa.cabang || '').toUpperCase(),
    customer: fupa.customer || '',
    npwp: '',
    bumn: '',
    noPo: prospect?.noPo || '',
    noOe: '',
    disetujuiLangganan: '',
    lines,
    instruksi,
    tglKirim: janji || est,
    jangkaBayar: '',
    dibuatOleh: fupa.requestedBy || '',
    tglDibuat: tgl,
    diperiksaOleh: '',
    tglDiperiksa: '',
    disetujuiOleh: '',
    tglDisetujui: '',
    ppn: SPP_PPN_DEFAULT,
  };
}
