import { lostDateOf } from './lose-date';
import { classify, formatDateID, formatRupiah, materialUnitPrice, num } from './format';
import { WORKFLOW_META, fupaAsWorkflowDoc, rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import { ACTIVITY_LABEL, CUSTOMER_APLIKASI_LABEL, PIC_PERAN_LABEL, STATUS_META } from './constants';
import { QCD_FAKTOR_LABEL } from './qcd';
import { ISSUE_STATUS_META, HASIL_META, eskalasiLabel, issueCatLabel, urgensiLabel, type PipelineIssue } from './issues';
import { KAM_TIER_META } from './kam';
import { TRIP_HASIL_LABEL, TRIP_STATUS_META } from './visit-trip';
import type { AnnualTarget, BudgetTarget, Customer, CustomerGroup, Fupa, Prospect, Rfq, RfqItem, SalesActivity, SalesPlan, SeTarget, Vendor, VisitTrip } from './types';

/** What every builder below returns — enough for xlsx.utils.aoa_to_sheet plus column widths, and a sheet name that stays under Excel's 31-char sheet-name limit. */
export interface SheetSpec {
  sheetName: string;
  header: string[];
  rows: unknown[][];
  colWidths: { wch: number }[];
  /** Optional Excel number format per column index, e.g. '#,##0' for Rupiah. */
  numFormats?: Record<number, string>;
}

/**
 * Prospects, one row per MATERIAL line: a quotation with three materials
 * becomes three rows, so every material's unit price is visible. The
 * prospect's own columns (customer, dates, total value, status, ...) are
 * filled on its first row only and left blank on the rows below it -- the
 * same layout as the RFQ sheet -- which keeps SUM(VALUE) correct and keeps
 * the file re-importable through Import Excel (rows without CUSTOMER are
 * skipped there, and URAIAN PRODUCT still carries the full description).
 *
 * Material columns: HARGA SATUAN is the unit price per pc -- berat/pc x
 * harga/kg when both are filled, otherwise the flat price (materialUnitPrice);
 * SUBTOTAL = qty x harga satuan. A legacy prospect saved before materials
 * existed gets one material row derived from its own uraian/qty/value.
 */
/** Strips float noise (19.6 x 95000 = 1862000.0000000002). */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Segmen customer per nama (Kelola Customer) untuk kolom SEGMEN di sheet Prospek. */
export function customerSegmentLookup(customers: Pick<Customer, 'name' | 'segmen' | 'subSegmen'>[]): (name: string) => string {
  const key = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = new Map(customers.map((c) => [key(c.name || ''), [c.segmen, c.subSegmen].filter(Boolean).join(' › ')]));
  return (name) => m.get(key(name || '')) || '';
}

export function buildProspectSheet(list: Prospect[], segOf?: (customer: string) => string): SheetSpec {
  const header = [
    'REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'NO. PO', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)',
    'NO. MATERIAL', 'LINE MATERIAL', 'URAIAN MATERIAL', 'QTY MATERIAL (Pcs)', 'BERAT/PC (Kg)', 'HARGA/KG (Rp)', 'HARGA SATUAN (Rp)', 'SUBTOTAL MATERIAL (Rp)',
    'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'KLASIFIKASI', 'STATUS PENAWARAN', 'STATUS FAKTUR', 'TGL. LOSE ORDER',
    // Kolom tambahan di ujung kanan supaya file tetap bisa diimpor ulang (Import Excel membaca per nama kolom).
    'NO. FAKTUR', 'TGL. FAKTUR', 'FOLLOW-UP', 'CATATAN FOLLOW-UP', 'KOMPETITOR (QCD)', 'FAKTOR MENANG/KALAH', 'CATATAN QCD', 'STATUS BERUBAH', 'DIBUAT',
    ...(segOf ? ['SEGMEN CUSTOMER'] : []),
  ];
  const rows: unknown[][] = [];
  list.forEach((r) => {
    const klas = classify(r);
    const head = [
      r.reg || '', r.cabang || '', r.se || '', r.customer || '', r.phone || '',
      r.tglPenawaran || '', r.noPo || '', r.tglPO || '', r.tglDelivery || '',
      r.line || '', r.uraian || '', num(r.qty), num(r.value),
    ];
    const tail = [
      r.kondisiStock || '', r.keterangan || '', num(r.status), klas,
      r.penawaranTerkirim ? 'Terkirim' : 'Pending',
      // Only meaningful once a deal is Won (DO/PO) — terfaktur otherwise sits
      // at its default false, so this reads as blank rather than a misleading
      // "GIT" for a deal that was never billed because it isn't Won yet.
      klas === 'Won' ? (r.terfaktur ? 'Omzet (Terfaktur)' : 'GIT (Belum Terfaktur)') : '',
      klas === 'Lost' ? lostDateOf(r) : '',
      klas === 'Won' ? r.noFaktur || '' : '',
      klas === 'Won' ? r.tglFaktur || '' : '',
      r.followUpAt ? String(r.followUpAt).slice(0, 10) : '',
      r.followUpNote || '',
      r.qcdKompetitor || '',
      r.qcdFaktor ? QCD_FAKTOR_LABEL[r.qcdFaktor] || r.qcdFaktor : '',
      r.qcdCatatan || '',
      r.statusChangedAt ? String(r.statusChangedAt).slice(0, 10) : '',
      r.createdAt ? String(r.createdAt).slice(0, 10) : '',
      ...(segOf ? [segOf(r.customer || '') || '(belum diisi)'] : []),
    ];
    const mats = (Array.isArray(r.materials) ? r.materials : []).filter((m) => (m.uraian || '').trim() || num(m.qty) || materialUnitPrice(m));
    const lines = mats.length
      ? mats.map((m) => {
          const unit = round2(materialUnitPrice(m));
          return [m.line || '', m.uraian || '', num(m.qty), num(m.beratPc) || '', num(m.hargaKg) || '', unit, round2(num(m.qty) * unit)];
        })
      : [[r.line || '', r.uraian || '', num(r.qty), '', '', num(r.qty) > 0 ? round2(num(r.value) / num(r.qty)) : num(r.value), num(r.value)]];
    lines.forEach((mat, idx) => {
      const first = idx === 0;
      rows.push([...(first ? head : head.map(() => '')), idx + 1, ...mat, ...(first ? tail : tail.map(() => ''))]);
    });
  });
  const colWidths = [
    { wch: 5 }, { wch: 8 }, { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 32 }, { wch: 8 }, { wch: 16 },
    { wch: 6 }, { wch: 8 }, { wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 17 },
    { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 14 },
    { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 12 }, { wch: 12 },
    ...(segOf ? [{ wch: 26 }] : []),
  ];
  const rp = '#,##0';
  const numFormats: Record<number, string> = { 11: rp, 12: rp, 16: '#,##0.##', 17: '#,##0.###', 18: rp, 19: rp, 20: rp };
  return { sheetName: 'Prospek', header, rows, colWidths, numFormats };
}

export function buildRfqSheet(list: Rfq[]): SheetSpec {
  // Kolom HPP hanya bila datanya ada — server tidak pernah mengirim HPP ke role Sales-side.
  const withHpp = list.some((r) => (r.items || []).some((it) => (it as RfqItem & { hpp?: number }).hpp));
  const header = ['NO', 'NO RFQ', 'TANGGAL', 'CABANG', 'CUSTOMER', 'LINE', 'GRADE', 'MATERIAL', 'DIA (mm)', 'THICK (mm)', 'WIDTH (mm)', 'LENGTH (mm)', 'PCS', 'BERAT (KGS)', 'LOKAL/IMPORT', 'ESTIMASI KEBUTUHAN', 'HARGA (PURCHASING)', 'CURRENCY', 'UOM', 'DELIVERY TIME', 'ORIGIN', 'NOTE', 'NO QUOTE', ...(withHpp ? ['VENDOR', 'HPP', 'MATA UANG HPP', 'KURS', 'MARGIN %'] : []), 'STATUS', 'STATUS PURCHASING', 'TERKIRIM KE PURCHASING', 'JAWABAN RFQ', 'DIBUAT OLEH'];
  const rows: unknown[][] = [];
  let no = 1;
  list.forEach((r) => {
    const items = r.items?.length ? r.items : ([{}] as RfqItem[]);
    items.forEach((it, idx) => {
      rows.push([
        idx === 0 ? no : '', idx === 0 ? r.noRfq || '' : '', idx === 0 ? formatDateID(r.tglRfq) : '',
        idx === 0 ? r.cabang || '' : '', idx === 0 ? r.customer || '' : '',
        it.line || '', it.grade || '', it.material || '', it.dia || '', it.thick || '', it.width || '', it.length || '',
        it.pcs || '', it.berat || '', it.lokal || '', it.estimasi || '',
        it.hargaPurchasing || '', it.currency || '', it.uom || '', it.deliveryTime || '', it.coo || '', it.note || '', it.noQuote ? 'Ya' : '',
        ...(withHpp
          ? (() => {
              const h = it as RfqItem & { hpp?: number; hppCur?: string; kurs?: number; margin?: number; vendorNama?: string };
              return [h.vendorNama || '', h.hpp || '', h.hpp ? h.hppCur || 'IDR' : '', h.hpp ? h.kurs || '' : '', h.hpp ? h.margin ?? '' : ''];
            })()
          : []),
        idx === 0 ? r.status || 'Draft' : '',
        idx === 0 ? WORKFLOW_META[workflowStage(rfqAsWorkflowDoc(r))].label : '',
        idx === 0 ? (r.sentToPurchasingAt ? formatDateID(r.sentToPurchasingAt) : 'Belum') : '',
        idx === 0 ? (r.jawabanRfqDikirim ? formatDateID(r.jawabanRfqAt) : 'Belum') : '',
        idx === 0 ? r.requestedBy || '' : '',
      ]);
    });
    no++;
  });
  const colWidths = [{ wch: 4 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 22 }, { wch: 6 }, { wch: 10 }, { wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
  return { sheetName: 'RFQ', header, rows, colWidths };
}

export function buildFupaSheet(list: Fupa[]): SheetSpec {
  const header = ['NO', 'NO FUP A', 'TANGGAL', 'REF. RFQ', 'CABANG', 'CUSTOMER', 'LINE', 'GRADE', 'MATERIAL', 'PCS', 'BERAT (KGS)', 'LOKAL/IMPORT', 'ESTIMASI KEBUTUHAN', 'STATUS', 'STATUS PURCHASING', 'DIMINTA OLEH', 'CATATAN'];
  const rows: unknown[][] = [];
  let no = 1;
  list.forEach((f) => {
    const items = f.items?.length ? f.items : ([{}] as typeof f.items);
    items.forEach((it, idx) => {
      rows.push([
        idx === 0 ? no : '', idx === 0 ? f.noFupa || '' : '', idx === 0 ? formatDateID(f.tglFupa) : '',
        idx === 0 ? f.sourceNoRfq || '' : '', idx === 0 ? f.cabang || '' : '', idx === 0 ? f.customer || '' : '',
        it.line || '', it.grade || '', it.material || '', it.pcs || '', it.berat || '', it.lokal || '', it.estimasi || '',
        idx === 0 ? f.status : '', idx === 0 ? WORKFLOW_META[workflowStage(fupaAsWorkflowDoc(f))].label : '',
        idx === 0 ? f.requestedBy || '' : '', idx === 0 ? f.catatan || '' : '',
      ]);
    });
    no++;
  });
  const colWidths = [{ wch: 4 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 6 }, { wch: 10 }, { wch: 24 }, { wch: 6 }, { wch: 11 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 24 }];
  return { sheetName: 'FUP A', header, rows, colWidths };
}

export function buildCustomerSheet(list: Customer[]): SheetSpec {
  // One row per PIC (a customer with three PICs becomes three rows, the
  // company columns repeated) so every contact survives the export; a
  // customer with no PIC at all still gets a single row.
  const header = ['NAMA CUSTOMER', 'CABANG', 'PIC', 'JABATAN', 'PERAN PIC', 'NO TELP', 'EMAIL', 'ALAMAT', 'CATATAN', 'SEGMEN', 'SUB-SEGMEN', 'APLIKASI', 'POTENSI / TAHUN', 'KOMPETITOR'];
  const rows: unknown[][] = [];
  list.forEach((c) => {
    const pics: { nama: string; jabatan: string | null; phone: string | null; email: string | null; peran?: string | null }[] =
      Array.isArray(c.pics) && c.pics.length > 0 ? c.pics : [{ nama: c.pic || '', jabatan: null, phone: c.phone, email: c.email }];
    const apl = (Array.isArray(c.aplikasi) ? c.aplikasi : []).map((k) => CUSTOMER_APLIKASI_LABEL[k] || k).join(', ');
    pics.forEach((p) =>
      rows.push([c.name || '', c.cabang || '', p.nama || '', p.jabatan || '', PIC_PERAN_LABEL[p.peran || ''] || '', p.phone || '', p.email || '', c.address || '', c.catatan || '', c.segmen || '', c.subSegmen || '', apl, c.potensi || '', c.kompetitor || '']),
    );
  });
  const colWidths = [{ wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 26 }, { wch: 18 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 24 }];
  return { sheetName: 'Customer', header, rows, colWidths };
}

export function buildVendorSheet(list: Vendor[]): SheetSpec {
  const header = ['NAMA VENDOR', 'PIC', 'NO WHATSAPP', 'EMAIL', 'KATEGORI', 'ALAMAT', 'CATATAN'];
  const rows = list.map((v) => [v.nama || '', v.pic || '', v.wa || '', v.email || '', v.kategori || '', v.alamat || '', v.catatan || '']);
  const colWidths = [{ wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 36 }, { wch: 26 }];
  return { sheetName: 'Vendor', header, rows, colWidths };
}

export function buildSalesPlanSheet(list: SalesPlan[]): SheetSpec {
  const header = ['PERIODE', 'SE', 'CABANG', 'REGIONAL', 'LINE', 'URAIAN MATERIAL', 'QTY', 'HARGA', 'VALUE BARIS', 'TOTAL RENCANA', 'DIISI OLEH'];
  const rows: unknown[][] = [];
  list.forEach((p) => {
    const items = p.items.length ? p.items : [{ line: '', uraian: '', qty: '', harga: '' }];
    items.forEach((it, idx) => {
      rows.push([
        idx === 0 ? p.periode : '', idx === 0 ? p.se : '', idx === 0 ? p.cabang || '' : '', idx === 0 ? p.reg ?? '' : '',
        it.line || '', it.uraian || '', num(it.qty), num(it.harga), num(it.qty) * num(it.harga),
        idx === 0 ? p.value : '', idx === 0 ? p.requestedBy || '' : '',
      ]);
    });
  });
  const colWidths = [{ wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 6 }, { wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
  return { sheetName: 'Rencana Penjualan', header, rows, colWidths };
}

export function buildBudgetTargetSheet(list: BudgetTarget[]): SheetSpec {
  const header = ['PERIODE', 'CABANG', 'TARGET (Rp)'];
  const rows = list.map((t) => [t.periode, t.cabang, num(t.amount)]);
  const colWidths = [{ wch: 9 }, { wch: 8 }, { wch: 18 }];
  return { sheetName: 'Target Bulanan', header, rows, colWidths };
}

export function buildAnnualTargetSheet(list: AnnualTarget[]): SheetSpec {
  const header = ['TAHUN', 'CABANG', 'TARGET TAHUNAN (Rp)'];
  const rows = list.slice().sort((a, b) => b.year.localeCompare(a.year) || a.cabang.localeCompare(b.cabang)).map((t) => [t.year, t.cabang, num(t.amount)]);
  return { sheetName: 'Target Tahunan', header, rows, colWidths: [{ wch: 8 }, { wch: 8 }, { wch: 20 }], numFormats: { 2: '#,##0' } };
}

export function buildSeTargetSheet(list: SeTarget[]): SheetSpec {
  const header = ['PERIODE', 'CABANG', 'SE', 'TARGET (Rp)', 'DIATUR OLEH'];
  const rows = list.slice().sort((a, b) => b.periode.localeCompare(a.periode) || a.cabang.localeCompare(b.cabang) || a.se.localeCompare(b.se)).map((t) => [t.periode, t.cabang, t.se, num(t.amount), t.updatedBy || '']);
  return { sheetName: 'Target per Sales', header, rows, colWidths: [{ wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 18 }], numFormats: { 3: '#,##0' } };
}

/**
 * Key Account, satu baris per grup. Kolom MARGIN hanya untuk role yang boleh
 * melihat HPP/margin (lib/roles.ts#canSeeHpp) — Sales-side tidak pernah.
 */
export function buildKamSheet(list: CustomerGroup[], userName: (id: string | null) => string, showMargin: boolean): SheetSpec {
  const header = ['GRUP', 'TIER', 'SKOR', 'POLA', 'SEGMEN', 'CABANG UTAMA', 'CABANG PENDUKUNG', 'ENTITAS / CUSTOMER', 'SPONSOR', 'KETUA', 'SEKRETARIS', 'ANGGOTA', 'OMZET 12 BLN (Rp)', 'GROWTH YTD %', ...(showMargin ? ['MARGIN %'] : []), 'RATA-RATA 3 TH (Rp)', 'TARGET (Rp)', 'TRANSAKSI TERAKHIR', 'REVIEW BERIKUTNYA', 'RENCANA AKSI TERBUKA', 'CATATAN'];
  const rows = list.map((g) => [
    g.name, KAM_TIER_META[g.tier]?.label || g.tier, g.skor ?? '', g.pola || '', g.segmen || '', g.homeCabang || '', (g.supportCabang || []).join(', '),
    (g.entities || []).join('; '), g.sponsor || '', userName(g.ketuaId), userName(g.sekretarisId), (g.anggotaIds || []).map((id) => userName(id)).filter(Boolean).join(', '),
    g.l12m ?? '', g.growthYtd ?? '', ...(showMargin ? [g.margin ?? ''] : []), g.avg3y ?? '', g.target ?? '', g.lastTrx || '', g.reviewNext || '',
    (g.actions || []).filter((a) => a.status === 'belum' || a.status === 'berjalan').length, g.notes || '',
  ]);
  const colWidths = [30, 12, 6, 6, 18, 10, 16, 40, 18, 18, 18, 28, 16, 10, ...(showMargin ? [9] : []), 16, 16, 12, 12, 10, 30].map((wch) => ({ wch }));
  const rp = '#,##0';
  const o = showMargin ? 1 : 0;
  return { sheetName: 'Key Account', header, rows, colWidths, numFormats: { 12: rp, [14 + o]: rp, [15 + o]: rp } };
}

/** Masalah Pipeline (sama dengan export di papan Masalah). */
export function buildIssueSheet(list: PipelineIssue[], valueOf: (i: PipelineIssue) => number, userName: (id: string | null) => string, today: string): SheetSpec {
  const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000));
  const header = ['CUSTOMER', 'SE', 'CABANG', 'NILAI PROSPEK (Rp)', 'KATEGORI', 'URGENSI', 'STATUS', 'PENANGGUNG JAWAB', 'KETERANGAN', 'DIAJUKAN OLEH', 'DILAPORKAN OLEH', 'TGL LAPOR', 'UMUR (HARI)', 'TARGET SELESAI', 'ESKALASI', 'SOLUSI', 'HASIL'];
  const rows = list
    .filter((i) => i.status !== 'diabaikan')
    .map((i) => {
      const lapor = i.dilaporAt || i.createdAt;
      return [
        i.customer, i.se || '', i.cabang || '', valueOf(i), issueCatLabel(i.kategori), urgensiLabel(i.urgensi), ISSUE_STATUS_META[i.status]?.label || i.status,
        i.pjIds.map((id) => userName(id)).filter(Boolean).join(', '), i.keterangan, i.diajukanNama || '', i.dilaporNama || '', lapor.slice(0, 10),
        days(lapor, i.selesaiAt || today), i.targetDate || '', eskalasiLabel(i), i.solusi || i.alasanTolak || '', i.hasil ? HASIL_META[i.hasil] : '',
      ];
    });
  const colWidths = [28, 8, 8, 16, 18, 9, 18, 26, 40, 18, 18, 11, 8, 12, 16, 34, 14].map((wch) => ({ wch }));
  return { sheetName: 'Masalah Pipeline', header, rows, colWidths, numFormats: { 3: '#,##0' } };
}

/** Perjalanan Dinas, satu baris per kunjungan customer (perjalanan tanpa kunjungan tetap satu baris). */
export function buildTripSheet(list: VisitTrip[], userName: (id: string | null) => string): SheetSpec {
  const header = ['BERANGKAT', 'PULANG', 'PEMILIK', 'CABANG TUJUAN', 'KEPERLUAN', 'PESERTA', 'STATUS', 'DISETUJUI OLEH', 'TGL KUNJUNGAN', 'CUSTOMER', 'PIC', 'TUJUAN', 'REALISASI', 'HASIL', 'DI LUAR RENCANA', 'CATATAN REALISASI'];
  const rows: unknown[][] = [];
  list.forEach((t) => {
    const head = [t.tglBerangkat, t.tglPulang, t.ownerName, t.cabang, t.keperluan || '', (t.pesertaIds || []).map((id) => userName(id)).filter(Boolean).join(', '), TRIP_STATUS_META[t.status]?.label || t.status, t.approverName || ''];
    const visits = t.visits?.length ? t.visits : [null];
    visits.forEach((v, idx) => {
      rows.push([
        ...(idx === 0 ? head : head.map(() => '')),
        v?.tanggal || '', v?.customer || '', v?.pic || '', v?.tujuan || '', v?.realisasi || '', v?.hasil ? TRIP_HASIL_LABEL[v.hasil] || v.hasil : '', v?.tambahan ? 'Ya' : '',
        idx === 0 ? t.catatanRealisasi || '' : '',
      ]);
    });
  });
  const colWidths = [11, 11, 20, 10, 26, 26, 18, 18, 11, 28, 18, 28, 32, 16, 9, 30].map((wch) => ({ wch }));
  return { sheetName: 'Perjalanan Dinas', header, rows, colWidths };
}

const ACT_LABEL: Record<string, string> = ACTIVITY_LABEL;

/**
 * Aktivitas Harian, one row per activity, oldest first. PIC list is joined
 * into one cell ("Nama (Jabatan); ..."). Pipeline = current status of the
 * linked prospect when the viewer can see it.
 */
export function buildSalesActivitySheet(list: SalesActivity[], prospects: Pick<Prospect, 'id' | 'status'>[] = []): SheetSpec {
  const statusById = new Map(prospects.map((p) => [p.id, Number(p.status)]));
  const header = ['TANGGAL', 'SE', 'CABANG', 'REGIONAL', 'JENIS AKTIVITAS', 'CUSTOMER', 'PIC (JABATAN)', 'KETERANGAN', 'STATUS', 'SUMBER', 'PIPELINE', 'DIISI OLEH'];
  const rows = list
    .slice()
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.se.localeCompare(b.se) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((a) => {
      const st = a.prospectId ? statusById.get(a.prospectId) : undefined;
      return [
        a.tanggal, a.se, a.cabang || '', a.reg ?? '',
        ACT_LABEL[a.tipe] || a.tipe, a.customer,
        (a.pics || []).map((p) => (p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)).filter(Boolean).join('; '),
        a.keterangan || '',
        a.status === 'rencana' ? 'Rencana' : 'Selesai',
        a.sumber === 'followup' ? 'Otomatis (Follow-up)' : a.sumber === 'perjalanan' ? `Perjalanan Dinas${a.pendamping ? ` (didampingi ${a.pendamping})` : ''}` : a.sumber === 'aktivitas' ? 'Rencana dari hasil kontak' : 'Manual',
        a.prospectId ? (st != null ? STATUS_META[st]?.label || 'Di pipeline' : 'Di pipeline') : '',
        a.createdBy || '',
      ];
    });
  const colWidths = [{ wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 22 }, { wch: 30 }, { wch: 34 }, { wch: 50 }, { wch: 9 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
  return { sheetName: 'Aktivitas Harian', header, rows, colWidths };
}

export const STATUS_LEGEND: SheetSpec = {
  sheetName: 'Legend Status',
  header: ['STATUS', 'KETERANGAN'],
  rows: [[0, 'Sales Activity'], [1, 'Permintaan'], [2, 'Penawaran Harga'], [3, 'Negosiasi'], [4, 'PO / Kontrak'], [5, 'DO'], [6, 'Lose Order / Batal']],
  colWidths: [{ wch: 10 }, { wch: 24 }],
};

/** xlsx.utils/writeFile aren't typed here to avoid importing the package at module scope — every caller already dynamic-imports xlsx itself, this just writes into whatever module instance the caller passed in. */
export function appendSheet(XLSX: typeof import('xlsx'), wb: import('xlsx').WorkBook, spec: SheetSpec): void {
  const ws = XLSX.utils.aoa_to_sheet([spec.header, ...spec.rows]);
  ws['!cols'] = spec.colWidths;
  if (spec.numFormats) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = 1; r <= range.e.r; r++) {
      for (const [c, z] of Object.entries(spec.numFormats)) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: Number(c) })];
        if (cell && cell.t === 'n') cell.z = z;
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
}
