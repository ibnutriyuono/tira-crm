/**
 * Render DeckModel (lib/exec-deck.ts) menjadi PowerPoint dengan pptxgenjs.
 * Dipakai di browser (tombol Buat PPT) -- konstruktor PptxGenJS diberikan
 * pemanggil supaya modul ini bisa diuji di Node juga.
 *
 * Grafik memakai chart asli PowerPoint (bisa diedit datanya), bukan gambar.
 */
import type PptxGenJS from 'pptxgenjs';
import type { ChartSpec, DeckModel, DeckSlide, KpiTile, TableSpec } from './exec-deck';

const INK = '1A222B';
const STEEL = '2E5C7E';
const AMBER = 'C47F2C';
const SLATE = '6B7684';
const SOFT = 'F3F5F7';
const GRID = 'E3E8ED';
const GREEN = '2F8F5B';
const RUST = 'B94A3D';
const HEAD = 'Cambria';
const BODY = 'Calibri';

const W = 13.333;
const MX = 0.5;

type Pres = PptxGenJS;
type Slide = PptxGenJS.Slide;

export interface PptImage {
  /** "image/png;base64,...." */
  data: string;
  w: number;
  h: number;
}

const FMT: Record<ChartSpec['unit'], string> = { rpjt: '#,##0', pct: '0"%"', count: '#,##0', ton: '#,##0.0', hari: '0.0' };

function text(s: Slide, t: string | PptxGenJS.TextProps[], o: PptxGenJS.TextPropsOptions) {
  s.addText(t, { isTextBox: true, fontFace: BODY, color: INK, margin: 0, ...o });
}

function footer(s: Slide, d: DeckModel, n: number, total: number, dark = false) {
  const c = dark ? '8FA1B3' : SLATE;
  text(s, `CRM TIRA · ${d.scopeLabel} · ${d.periodLabel}`, { x: MX, y: 7.05, w: 8, h: 0.25, fontSize: 9, color: c });
  text(s, `${n} / ${total}`, { x: W - MX - 1.5, y: 7.05, w: 1.5, h: 0.25, fontSize: 9, color: c, align: 'right' });
}

function titleBlock(s: Slide, title: string, kicker?: string) {
  text(s, title, { x: MX, y: 0.32, w: W - MX * 2, h: 0.78, fontFace: HEAD, fontSize: 24, bold: true, color: INK, valign: 'top', fit: 'shrink' });
  if (kicker) text(s, kicker, { x: MX, y: 1.1, w: W - MX * 2, h: 0.3, fontSize: 12, color: SLATE, italic: true });
}

const empty = (c: ChartSpec) => !c.labels.length || c.series.every((sr) => sr.values.every((v) => !v));

function chart(pres: Pres, s: Slide, c: ChartSpec, x: number, y: number, w: number, h: number) {
  if (empty(c)) {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: SOFT }, line: { color: SOFT }, rectRadius: 0.08 });
    text(s, [{ text: c.title, options: { bold: true, breakLine: true } }, { text: 'Belum ada data pada periode ini', options: { color: SLATE } }], { x: x + 0.3, y: y + h / 2 - 0.35, w: w - 0.6, h: 0.7, fontSize: 12, align: 'center' });
    return;
  }
  const multi = c.series.length > 1;
  const pie = c.kind === 'pie' || c.kind === 'doughnut';
  const type = pie ? (c.kind === 'pie' ? pres.ChartType.pie : pres.ChartType.doughnut) : c.kind === 'line' ? pres.ChartType.line : pres.ChartType.bar;
  const data = c.series.map((sr) => ({ name: sr.name, labels: c.labels, values: sr.values }));
  const base: PptxGenJS.IChartOpts = {
    x,
    y,
    w,
    h,
    showTitle: true,
    title: c.title,
    titleFontFace: BODY,
    titleFontSize: 12,
    titleColor: INK,
    chartColors: c.colors && c.colors.length ? [...c.colors] : [STEEL, AMBER, GREEN, RUST, SLATE],
    showLegend: multi || pie,
    legendPos: 'b',
    legendFontSize: 10,
    legendFontFace: BODY,
    legendColor: INK,
  };
  if (pie) {
    s.addChart(type, data, { ...base, showPercent: true, showValue: false, dataLabelColor: 'FFFFFF', dataLabelFontSize: 10, holeSize: 55, dataLabelFontFace: BODY });
    return;
  }
  const stacked = c.kind === 'stacked';
  s.addChart(type, data, {
    ...base,
    barDir: c.kind === 'barH' ? 'bar' : 'col',
    barGrouping: stacked ? 'stacked' : 'clustered',
    barGapWidthPct: 60,
    catAxisLabelFontFace: BODY,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: SLATE,
    valAxisLabelFontFace: BODY,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: SLATE,
    valAxisLabelFormatCode: FMT[c.unit],
    valAxisMinVal: 0,
    valGridLine: { color: GRID, size: 0.75 },
    catGridLine: { style: 'none' },
    showValue: !stacked,
    dataLabelFormatCode: FMT[c.unit],
    dataLabelFontSize: 9,
    dataLabelFontFace: BODY,
    dataLabelColor: INK,
    ...(stacked ? {} : { dataLabelPosition: c.kind === 'line' ? 't' : 'outEnd' }),
    ...(c.kind === 'line' ? { lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 7 } : {}),
  });
}

function table(s: Slide, t: TableSpec, x: number, y: number, w: number, fontSize: number) {
  const widths = t.widths && t.widths.length === t.head.length ? t.widths : t.head.map(() => 1);
  const tot = widths.reduce((a, b) => a + b, 0);
  const colW = widths.map((v) => (v / tot) * w);
  const right = new Set(t.right || []);
  const rows: PptxGenJS.TableRow[] = [
    t.head.map((h, i) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: INK }, align: right.has(i) ? 'right' : 'left' } })),
    ...t.rows.map((r, ri) => r.map((cell, i) => ({ text: cell, options: { fill: { color: ri % 2 ? SOFT : 'FFFFFF' }, align: right.has(i) ? ('right' as const) : ('left' as const) } }))),
  ];
  s.addTable(rows, { x, y, w, colW, fontSize, fontFace: BODY, color: INK, border: { type: 'solid', color: GRID, pt: 0.75 }, margin: 0.05, valign: 'middle', autoPage: false });
}

/** Panel Temuan + Rekomendasi. `cols` = dua kolom berdampingan (strip bawah). */
function panel(pres: Pres, s: Slide, sl: DeckSlide, x: number, y: number, w: number, h: number, cols = false) {
  if (!sl.temuan.length && !sl.aksi.length) return;
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: SOFT }, line: { color: SOFT }, rectRadius: 0.1 });
  const block = (head: string, color: string, items: string[]): PptxGenJS.TextProps[] => [
    { text: head, options: { bold: true, color, fontSize: 13, breakLine: true, paraSpaceAfter: 4 } },
    ...items.map((t, i) => ({ text: t, options: { bullet: { indent: 14 }, fontSize: 12, color: INK, paraSpaceAfter: 5, breakLine: i < items.length - 1 } })),
  ];
  const pad = 0.22;
  const tem = sl.temuan.slice(0, cols ? 3 : 4);
  const aks = sl.aksi.slice(0, cols ? 2 : 3);
  if (cols) {
    const cw = (w - pad * 3) / 2;
    if (tem.length) text(s, block('Temuan', STEEL, tem), { x: x + pad, y: y + pad, w: cw, h: h - pad * 2, valign: 'top', fit: 'shrink' });
    if (aks.length) text(s, block('Rekomendasi', AMBER, aks), { x: x + pad * 2 + cw, y: y + pad, w: cw, h: h - pad * 2, valign: 'top', fit: 'shrink' });
    return;
  }
  const parts: PptxGenJS.TextProps[] = [...(tem.length ? block('Temuan', STEEL, tem) : [])];
  if (aks.length) {
    if (parts.length) {
      const last = parts[parts.length - 1];
      last.options = { ...last.options, breakLine: true, paraSpaceAfter: 12 };
    }
    parts.push(...block('Rekomendasi', AMBER, aks));
  }
  text(s, parts, { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2, valign: 'top', fit: 'shrink' });
}

function kpiTile(pres: Pres, s: Slide, k: KpiTile, x: number, y: number, w: number, h: number) {
  const tone = k.tone === 'good' ? GREEN : k.tone === 'bad' ? RUST : k.tone === 'warn' ? AMBER : STEEL;
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: SOFT }, line: { color: SOFT }, rectRadius: 0.1 });
  s.addShape(pres.ShapeType.ellipse, { x: x + 0.22, y: y + 0.24, w: 0.16, h: 0.16, fill: { color: tone }, line: { color: tone } });
  text(s, k.label.toUpperCase(), { x: x + 0.48, y: y + 0.18, w: w - 0.6, h: 0.28, fontSize: 10, bold: true, color: SLATE, charSpacing: 1 });
  text(s, k.value, { x: x + 0.22, y: y + 0.52, w: w - 0.4, h: 0.62, fontFace: HEAD, fontSize: 28, bold: true, color: INK, fit: 'shrink' });
  text(s, k.foot, { x: x + 0.22, y: y + h - 0.45, w: w - 0.4, h: 0.3, fontSize: 11, color: SLATE, fit: 'shrink' });
}

export async function renderExecDeck(PptxGen: new () => Pres, d: DeckModel, logo?: PptImage | null): Promise<Pres> {
  const pres = new PptxGen();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = d.generatedFor;
  pres.company = 'PT. TIRA AUSTENITE, Tbk';
  pres.title = `Laporan Analisa ${d.scopeLabel} ${d.periodLabel}`;
  const total = d.slides.length + 3;
  let n = 0;

  // ------------------------------------------------------------ sampul
  pres.addSection({ title: 'Pembuka' });
  {
    const s = pres.addSlide({ sectionTitle: 'Pembuka' });
    n++;
    s.background = { color: INK };
    if (logo) s.addImage({ data: logo.data, x: MX, y: 0.55, w: 1.3, h: (1.3 * logo.h) / Math.max(1, logo.w) });
    text(s, 'PT. TIRA AUSTENITE, Tbk · Steel Division', { x: MX, y: 1.75, w: 9, h: 0.35, fontSize: 14, bold: true, color: 'D7E3EC' });
    text(s, 'Laporan Analisa Penjualan', { x: MX, y: 2.2, w: 12, h: 0.95, fontFace: HEAD, fontSize: 44, bold: true, color: 'FFFFFF' });
    text(s, `${d.scopeLabel} · ${d.periodLabel}`, { x: MX, y: 3.2, w: 12, h: 0.5, fontSize: 22, color: 'D7E3EC' });
    text(s, d.headline, { x: MX, y: 4.1, w: 11.5, h: 0.9, fontSize: 18, italic: true, color: 'E8B472', valign: 'top', fit: 'shrink' });
    text(s, `Disiapkan untuk ${d.generatedFor} (${d.roleLabel}) · ${d.generatedAt} · Internal & rahasia`, { x: MX, y: 6.6, w: 12, h: 0.3, fontSize: 11, color: '8FA1B3' });
  }

  // ------------------------------------------------------------ ringkasan eksekutif
  {
    const s = pres.addSlide({ sectionTitle: 'Pembuka' });
    n++;
    s.background = { color: 'FFFFFF' };
    titleBlock(s, 'Ringkasan Eksekutif', `${d.scopeLabel} · ${d.periodLabel}`);
    const tw = 2.55;
    const th = 1.62;
    d.kpis.slice(0, 6).forEach((k, i) => kpiTile(pres, s, k, MX + (i % 3) * (tw + 0.2), 1.65 + Math.floor(i / 3) * (th + 0.22), tw, th));
    const px = MX + 3 * (tw + 0.2) + 0.1;
    const pw = W - MX - px;
    s.addShape(pres.ShapeType.roundRect, { x: px, y: 1.65, w: pw, h: th * 2 + 0.22, fill: { color: INK }, line: { color: INK }, rectRadius: 0.1 });
    text(
      s,
      [
        { text: 'Pesan utama', options: { bold: true, fontSize: 14, color: 'E8B472', breakLine: true, paraSpaceAfter: 6 } },
        ...d.keyMessages.slice(0, 5).map((m, i, arr) => ({ text: m, options: { bullet: { type: 'number' as const }, fontSize: 12, color: 'FFFFFF', paraSpaceAfter: 6, breakLine: i < arr.length - 1 } })),
      ],
      { x: px + 0.25, y: 1.85, w: pw - 0.5, h: th * 2 - 0.2, valign: 'top', fit: 'shrink' },
    );
    text(s, [{ text: 'Isi laporan: ', options: { bold: true } }, { text: d.agenda.join(' · ') }], { x: MX, y: 5.45, w: W - MX * 2, h: 0.35, fontSize: 12, color: SLATE });
    text(s, 'Angka mengikuti cakupan data dan hak akses akun pembuat laporan. Realisasi = PO/Kontrak + DO; nilai dalam Rupiah.', { x: MX, y: 5.85, w: W - MX * 2, h: 0.3, fontSize: 10, color: SLATE, italic: true });
    footer(s, d, n, total);
  }

  // ------------------------------------------------------------ slide analisa
  let section = '';
  for (const sl of d.slides) {
    if (sl.section !== section) {
      section = sl.section;
      pres.addSection({ title: section });
    }
    const s = pres.addSlide({ sectionTitle: section });
    n++;
    s.background = { color: 'FFFFFF' };
    text(s, sl.section.toUpperCase(), { x: MX, y: 0.12, w: 6, h: 0.22, fontSize: 9, bold: true, color: AMBER, charSpacing: 2 });
    titleBlock(s, sl.title, sl.kicker);
    const top = 1.6;
    const bottom = 6.85;
    const hasPanel = sl.temuan.length + sl.aksi.length > 0;
    if (sl.table && sl.charts.length) {
      const h = 3.35;
      chart(pres, s, sl.charts[0], MX, top, 4.9, h);
      table(s, sl.table, MX + 5.15, top + 0.05, W - MX * 2 - 5.15, 10);
      if (hasPanel) panel(pres, s, sl, MX, top + h + 0.2, W - MX * 2, bottom - top - h - 0.2, true);
    } else if (sl.table) {
      table(s, sl.table, MX, top, W - MX * 2, 11);
      if (hasPanel) panel(pres, s, sl, MX, 5.2, W - MX * 2, bottom - 5.2, true);
    } else {
      const cw = hasPanel ? 8.15 : W - MX * 2;
      const nC = Math.min(2, sl.charts.length);
      const gap = 0.25;
      sl.charts.slice(0, 2).forEach((c, i) => {
        const w = (cw - gap * (nC - 1)) / nC;
        chart(pres, s, c, MX + i * (w + gap), top, w, bottom - top);
      });
      if (hasPanel) panel(pres, s, sl, MX + cw + 0.3, top, W - MX - (MX + cw + 0.3), bottom - top);
    }
    footer(s, d, n, total);
  }

  // ------------------------------------------------------------ prioritas tindakan
  pres.addSection({ title: 'Penutup' });
  {
    const s = pres.addSlide({ sectionTitle: 'Penutup' });
    n++;
    s.background = { color: INK };
    text(s, 'Prioritas Tindakan', { x: MX, y: 0.45, w: 12, h: 0.75, fontFace: HEAD, fontSize: 32, bold: true, color: 'FFFFFF' });
    text(s, 'Disusun dari temuan setiap bagian laporan ini', { x: MX, y: 1.2, w: 12, h: 0.35, fontSize: 13, italic: true, color: '8FA1B3' });
    const acts = d.actions.slice(0, 8);
    if (!acts.length) {
      text(s, 'Tidak ada tindakan mendesak — pertahankan ritme saat ini.', { x: MX, y: 2.2, w: 12, h: 0.6, fontSize: 18, color: 'D7E3EC' });
    }
    const colW = (W - MX * 2 - 0.4) / 2;
    acts.forEach((a, i) => {
      const col = i < 4 ? 0 : 1;
      const row = i % 4;
      const x = MX + col * (colW + 0.4);
      const y = 1.85 + row * 1.22;
      s.addShape(pres.ShapeType.ellipse, { x, y: y + 0.05, w: 0.5, h: 0.5, fill: { color: AMBER }, line: { color: AMBER } });
      text(s, String(i + 1), { x, y: y + 0.05, w: 0.5, h: 0.5, fontSize: 15, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
      text(s, [{ text: `${a.section.toUpperCase()}`, options: { fontSize: 9, bold: true, color: 'E8B472', breakLine: true, charSpacing: 1 } }, { text: a.text, options: { fontSize: 12.5, color: 'FFFFFF' } }], { x: x + 0.7, y, w: colW - 0.75, h: 1.08, valign: 'top', fit: 'shrink' });
    });
    footer(s, d, n, total, true);
  }
  return pres;
}
