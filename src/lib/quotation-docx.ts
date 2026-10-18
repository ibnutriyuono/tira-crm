/**
 * Surat Penawaran -> file Word asli (.docx), dibangun dari model yang sama
 * dengan pratinjau (lib/quotation-doc.ts). Dimuat dinamis di browser saat
 * tombol Unduh ditekan, jadi tidak menambah ukuran halaman awal.
 */
import { quoteColumns, quoteTerms, quoteTexts, quoteTotals, terbilang, type QuoteData, type QuoteOpts } from './quotation-doc';

const INK = '1A222B';
const STEEL = '456484';
const AMBER = 'C47F2C';
const SOFT = '5B6573';
const GRID = 'C9D3DD';
const ZEBRA = 'F3F5F7';

/** A4, margin 2 cm kiri/kanan. */
const PAGE_W = 11906;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - MARGIN * 2;

export interface LogoImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export async function buildQuoteDocx(d: QuoteData, o: QuoteOpts, logo: LogoImage | null, signature: LogoImage | null = null): Promise<Blob> {
  const D = await import('docx');
  const { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType } = D;

  const tx = quoteTexts(d);
  const cols = quoteColumns(d, o);
  const tot = quoteTotals(d, o);
  const terms = quoteTerms(d, o);
  const items = d.items.filter((it) => it.uraian.trim());

  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
  /** Tabel tata letak (tanpa garis) rata kiri dengan paragraf biasa. */
  const flush = { top: 0, bottom: 0, left: 0, right: 0 };
  const thin = { style: BorderStyle.SINGLE, size: 4, color: GRID };
  const align = (a: 'left' | 'center' | 'right') => (a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT);

  const run = (text: string, opt: { bold?: boolean; italics?: boolean; size?: number; color?: string; underline?: boolean; allCaps?: boolean } = {}) =>
    new TextRun({ text, bold: opt.bold, italics: opt.italics, size: opt.size, color: opt.color, underline: opt.underline ? {} : undefined, allCaps: opt.allCaps });
  /** Paragraf; teks bisa berisi baris baru. */
  const para = (text: string, opt: { bold?: boolean; italics?: boolean; size?: number; color?: string; after?: number; before?: number; align?: 'left' | 'center' | 'right' | 'justify' } = {}) =>
    new Paragraph({
      alignment: opt.align === 'justify' ? AlignmentType.JUSTIFIED : opt.align ? align(opt.align) : undefined,
      spacing: { after: opt.after ?? 120, before: opt.before ?? 0, line: 276 },
      children: text.split('\n').flatMap((ln, i) => [...(i ? [new TextRun({ break: 1 })] : []), run(ln, opt)]),
    });
  const tw = (pct: number) => Math.round((CONTENT_W * pct) / 100);

  const blocks: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  // ---------------------------------------------------------------- kop
  // Kop surat ada di Header Word halaman pertama ("Different First Page");
  // halaman berikutnya memakai header ringkas berisi nama perusahaan + nomor surat.
  const kop: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  if (o.kop) {
    const logoW = 62;
    const logoCell = new TableCell({
      width: { size: tw(11), type: WidthType.DXA },
      borders: noBorders,
      margins: flush,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          children: logo
            ? [new ImageRun({ type: 'png', data: logo.data, transformation: { width: logoW, height: Math.round((logoW * logo.height) / Math.max(1, logo.width)) } })]
            : [],
        }),
      ],
    });
    const textCell = new TableCell({
      width: { size: tw(89), type: WidthType.DXA },
      borders: noBorders,
      margins: flush,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({ spacing: { after: 0 }, children: [run(tx.company, { bold: true, size: 32, color: INK })] }),
        new Paragraph({ spacing: { after: d.kopText.trim() ? 40 : 0 }, children: [run(tx.division, { bold: true, size: 18, color: STEEL, allCaps: true })] }),
        ...(d.kopText.trim() ? [para(d.kopText.trim(), { size: 16, color: SOFT, after: 0 })] : []),
      ],
    });
    kop.push(
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [tw(11), tw(89)],
        layout: TableLayoutType.FIXED,
        borders: noBorders,
        rows: [new TableRow({ children: [logoCell, textCell] })],
      }),
      new Paragraph({ spacing: { after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: AMBER, space: 4 } }, children: [] }),
    );
  }
  const firstHeader = new Header({ children: kop.length ? kop : [new Paragraph({ children: [] })] });
  const nextHeader = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AMBER, space: 4 } },
        children: [run(tx.company, { bold: true, size: 18, color: INK }), run(`  ·  ${tx.division}`, { size: 16, color: STEEL }), new TextRun({ text: `\tSurat Penawaran No. ${d.nomor}`, size: 16, color: SOFT })],
      }),
    ],
  });

  // ---------------------------------------------------------------- nomor / tanggal
  const metaRows: [string, string, boolean][] = [['Nomor', d.nomor, false], ...(o.lampiran ? ([['Lampiran', d.lampiran || '-', false]] as [string, string, boolean][]) : []), ['Perihal', d.perihal, true]];
  blocks.push(
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [tw(13), tw(57), tw(30)],
      layout: TableLayoutType.FIXED,
      borders: noBorders,
      rows: metaRows.map(([k, v, b], i) =>
        new TableRow({
          children: [
            new TableCell({ borders: noBorders, margins: flush, width: { size: tw(13), type: WidthType.DXA }, children: [para(k, { after: 20 })] }),
            new TableCell({ borders: noBorders, margins: flush, width: { size: tw(57), type: WidthType.DXA }, children: [para(`: ${v}`, { bold: b, after: 20 })] }),
            new TableCell({ borders: noBorders, margins: flush, width: { size: tw(30), type: WidthType.DXA }, children: [para(i === 0 ? tx.tempatTanggal : '', { align: 'right', after: 20 })] }),
          ],
        }),
      ),
    }),
    para('', { after: 120 }),
  );

  // ---------------------------------------------------------------- tujuan
  blocks.push(
    para('Kepada Yth.', { after: 0 }),
    para(d.kepada, { bold: true, after: 0 }),
    ...(o.alamat && d.alamat.trim() ? [para(d.alamat.trim(), { after: 0 })] : []),
    ...(o.pic && d.pic.trim() ? [para(`Up. ${d.pic.trim()}`, { after: 0 })] : []),
    para('', { after: 120 }),
    para(tx.pembuka),
    para(tx.intro, { align: 'justify' }),
  );

  // ---------------------------------------------------------------- tabel material
  const wsum = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => tw((c.w / wsum) * 100));
  const cell = (text: string, i: number, opt: { head?: boolean; zebra?: boolean; bold?: boolean; span?: number; a?: 'left' | 'center' | 'right'; fill?: string } = {}) =>
    new TableCell({
      columnSpan: opt.span,
      width: { size: opt.span ? widths.slice(i, i + opt.span).reduce((s, w) => s + w, 0) : widths[i], type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 70, right: 70 },
      shading: opt.head ? { type: ShadingType.CLEAR, fill: INK, color: 'auto' } : opt.fill ? { type: ShadingType.CLEAR, fill: opt.fill, color: 'auto' } : opt.zebra ? { type: ShadingType.CLEAR, fill: ZEBRA, color: 'auto' } : undefined,
      children: [
        new Paragraph({
          alignment: align(opt.head ? 'center' : opt.a || 'left'),
          spacing: { after: 0 },
          children: [run(text, { bold: opt.head || opt.bold, color: opt.head ? 'FFFFFF' : INK, size: opt.head ? 18 : 20 })],
        }),
      ],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c.label, i, { head: true })) }),
    ...items.map((it, r) => new TableRow({ cantSplit: true, children: cols.map((c, i) => cell(c.cell(it, r), i, { a: c.align, zebra: r % 2 === 1 })) })),
    ...tot.rows.map(
      (t) =>
        new TableRow({
          cantSplit: true,
          children: [cell(t.label, 0, { span: cols.length - 1, a: 'right', bold: t.bold, fill: t.bold ? 'FBF1E4' : undefined }), cell(t.value, cols.length - 1, { a: 'right', bold: t.bold, fill: t.bold ? 'FBF1E4' : undefined })],
        }),
    ),
  ];
  blocks.push(
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin },
      rows,
    }),
  );
  if (o.terbilang) {
    blocks.push(new Paragraph({ spacing: { before: 80, after: 160 }, children: [run('Terbilang: ', { size: 20, color: SOFT }), run(terbilang(tot.grand), { italics: true, size: 20 })] }));
  } else {
    blocks.push(para('', { after: 80 }));
  }

  // ---------------------------------------------------------------- syarat
  blocks.push(para('Syarat & Ketentuan', { bold: true, before: 120, after: 60 }));
  blocks.push(
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [tw(22), tw(78)],
      layout: TableLayoutType.FIXED,
      borders: noBorders,
      rows: terms.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({ borders: noBorders, margins: flush, width: { size: tw(22), type: WidthType.DXA }, children: [para(k, { after: 40 })] }),
              new TableCell({ borders: noBorders, margins: flush, width: { size: tw(78), type: WidthType.DXA }, children: [para(`: ${v}`, { after: 40 })] }),
            ],
          }),
      ),
    }),
  );
  if (o.catatan && d.catatan.trim()) blocks.push(para('Catatan', { bold: true, before: 160, after: 60 }), para(d.catatan.trim(), { align: 'justify' }));

  // ---------------------------------------------------------------- penutup & tanda tangan
  const sig = o.ttdGambar ? signature : null;
  blocks.push(para(tx.penutup, { before: 160, align: 'justify' }), para('Hormat kami,', { before: 120, after: 0 }), para(tx.company, { after: sig ? 40 : o.ttd ? 960 : 120 }));
  if (sig) {
    // Tinggi tetap ±1,6 cm; lebar mengikuti rasio gambar (maks. ±5,3 cm).
    let h = 60;
    let w = Math.round((h * sig.width) / Math.max(1, sig.height));
    if (w > 200) {
      w = 200;
      h = Math.round((w * sig.height) / Math.max(1, sig.width));
    }
    blocks.push(new Paragraph({ spacing: { after: 20 }, keepNext: true, children: [new ImageRun({ type: 'png', data: sig.data, transformation: { width: w, height: h } })] }));
  }
  blocks.push(new Paragraph({ spacing: { after: 0 }, children: [run(d.signer.nama, { bold: true, underline: true })] }));
  if (d.signer.jabatan.trim()) blocks.push(para(d.signer.jabatan.trim(), { after: 0 }));
  if (o.kontak) {
    if (d.signer.telp.trim()) blocks.push(para(`Telp/WA: ${d.signer.telp.trim()}`, { size: 18, color: SOFT, after: 0 }));
    if (d.signer.email.trim()) blocks.push(para(`Email: ${d.signer.email.trim()}`, { size: 18, color: SOFT, after: 0 }));
  }

  const makeFooter = () => new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: GRID, space: 4 } },
        children: [run(`${d.nomor}  ·  Halaman `, { size: 16, color: SOFT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: SOFT }), run(' dari ', { size: 16, color: SOFT }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: SOFT })],
      }),
    ],
  });

  const doc = new Document({
    creator: tx.company,
    title: `Surat Penawaran ${d.nomor}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: INK } } } },
    sections: [
      {
        properties: { titlePage: true, page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1300, bottom: 1000, left: MARGIN, right: MARGIN, header: 500, footer: 500 } } },
        headers: { first: firstHeader, default: nextHeader },
        footers: { first: makeFooter(), default: makeFooter() },
        children: blocks,
      },
    ],
  });
  return Packer.toBlob(doc);
}

/** Gambar PNG (logo kop / tanda tangan) beserta ukurannya, untuk disisipkan ke .docx. */
export async function loadLogo(src = '/logo.png'): Promise<LogoImage | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const out = { data: new Uint8Array(await blob.arrayBuffer()), width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}
