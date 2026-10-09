import { classify, formatDateID, formatRupiah, materialUnitPrice, num } from './format';
import { WORKFLOW_META, fupaAsWorkflowDoc, rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import { ACTIVITY_TYPES, STATUS_META } from './constants';
import type { BudgetTarget, Customer, Fupa, Prospect, Rfq, RfqItem, SalesActivity, SalesPlan, Vendor } from './types';

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

export function buildProspectSheet(list: Prospect[]): SheetSpec {
  const header = [
    'REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'NO. PO', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)',
    'NO. MATERIAL', 'LINE MATERIAL', 'URAIAN MATERIAL', 'QTY MATERIAL (Pcs)', 'BERAT/PC (Kg)', 'HARGA/KG (Rp)', 'HARGA SATUAN (Rp)', 'SUBTOTAL MATERIAL (Rp)',
    'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'KLASIFIKASI', 'STATUS PENAWARAN', 'STATUS FAKTUR',
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
    { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 20 },
  ];
  const rp = '#,##0';
  const numFormats: Record<number, string> = { 11: rp, 12: rp, 16: '#,##0.##', 17: '#,##0.###', 18: rp, 19: rp, 20: rp };
  return { sheetName: 'Prospek', header, rows, colWidths, numFormats };
}

export function buildRfqSheet(list: Rfq[]): SheetSpec {
  const header = ['NO', 'NO RFQ', 'TANGGAL', 'CABANG', 'CUSTOMER', 'LINE', 'GRADE', 'MATERIAL', 'DIA (mm)', 'THICK (mm)', 'WIDTH (mm)', 'LENGTH (mm)', 'PCS', 'BERAT (KGS)', 'LOKAL/IMPORT', 'ESTIMASI KEBUTUHAN', 'HARGA (PURCHASING)', 'CURRENCY', 'UOM', 'DELIVERY TIME', 'ORIGIN', 'NOTE', 'NO QUOTE', 'STATUS', 'STATUS PURCHASING', 'TERKIRIM KE PURCHASING', 'JAWABAN RFQ', 'DIBUAT OLEH'];
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
  const header = ['NAMA CUSTOMER', 'CABANG', 'PIC', 'JABATAN', 'NO TELP', 'EMAIL', 'ALAMAT', 'CATATAN'];
  const rows: unknown[][] = [];
  list.forEach((c) => {
    const pics = Array.isArray(c.pics) && c.pics.length > 0 ? c.pics : [{ nama: c.pic || '', jabatan: null, phone: c.phone, email: c.email }];
    pics.forEach((p) => rows.push([c.name || '', c.cabang || '', p.nama || '', p.jabatan || '', p.phone || '', p.email || '', c.address || '', c.catatan || '']));
  });
  const colWidths = [{ wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 26 }];
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

const ACT_LABEL: Record<string, string> = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.label]));

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
        a.sumber === 'followup' ? 'Otomatis (Follow-up)' : 'Manual',
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
