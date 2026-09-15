import { classify, formatDateID, formatRupiah, num } from './format';
import { WORKFLOW_META, fupaAsWorkflowDoc, rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import type { BudgetTarget, Customer, Fupa, Prospect, Rfq, RfqItem, SalesPlan, Vendor } from './types';

/** What every builder below returns — enough for xlsx.utils.aoa_to_sheet plus column widths, and a sheet name that stays under Excel's 31-char sheet-name limit. */
export interface SheetSpec {
  sheetName: string;
  header: string[];
  rows: unknown[][];
  colWidths: { wch: number }[];
}

export function buildProspectSheet(list: Prospect[]): SheetSpec {
  const header = ['REG', 'CABANG', 'SE', 'CUSTOMER', 'NO. WHATSAPP', 'TGL. PENAWARAN', 'TGL. PO', 'TGL. DELIVERY', 'LINE', 'URAIAN PRODUCT', 'QTY (Pcs)', 'VALUE (Rp)', 'KONDISI STOCK', 'KETERANGAN', 'STATUS', 'KLASIFIKASI', 'STATUS PENAWARAN', 'STATUS FAKTUR'];
  const rows = list.map((r) => [
    r.reg || '', r.cabang || '', r.se || '', r.customer || '', r.phone || '',
    r.tglPenawaran || '', r.tglPO || '', r.tglDelivery || '',
    r.line || '', r.uraian || '', num(r.qty), num(r.value),
    r.kondisiStock || '', r.keterangan || '', num(r.status), classify(r),
    r.penawaranTerkirim ? 'Terkirim' : 'Pending',
    // Only meaningful once a deal is Won (DO/PO) — terfaktur otherwise sits
    // at its default false, so this reads as blank rather than a misleading
    // "GIT" for a deal that was never billed because it isn't Won yet.
    classify(r) === 'Won' ? (r.terfaktur ? 'Omzet (Terfaktur)' : 'GIT (Belum Terfaktur)') : '',
  ]);
  const colWidths = [{ wch: 5 }, { wch: 8 }, { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 20 }];
  return { sheetName: 'Prospek', header, rows, colWidths };
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
  const header = ['NAMA CUSTOMER', 'CABANG', 'PIC', 'NO TELP', 'EMAIL', 'ALAMAT', 'CATATAN'];
  const rows = list.map((c) => [c.name || '', c.cabang || '', c.pic || '', c.phone || '', c.email || '', c.address || '', c.catatan || '']);
  const colWidths = [{ wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 26 }];
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
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
}
