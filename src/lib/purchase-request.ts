import { formatDateID } from './format';
import type { RfqItem } from './types';

export interface PurchaseRequestDoc {
  no: string;
  tgl: string;
  cabang: string;
  customer: string;
  requestedBy: string;
  items: RfqItem[];
  catatan?: string;
  attachmentCount?: number;
}

/**
 * WhatsApp / email body for an RFQ or FUP A, ported from the single-file app's
 * buildPurchaseRequestMessageText() so both documents read identically to the
 * versions Purchasing already receives today.
 */
export function buildPurchaseRequestMessage(title: string, d: PurchaseRequestDoc): string {
  const lines: string[] = [];
  lines.push(`*${title}*`);
  lines.push(`No: ${d.no || '-'}`);
  lines.push(`Tanggal: ${formatDateID(d.tgl)}`);
  lines.push(`Cabang: ${d.cabang || '-'}`);
  lines.push(`Customer: ${d.customer || '-'}`);
  lines.push(`Diminta oleh: ${d.requestedBy || '-'}`);
  lines.push('');
  lines.push('Detail Material:');

  d.items.forEach((it, i) => {
    lines.push(`${i + 1}. Line ${it.line || '-'} | Grade ${it.grade || '-'}`);
    lines.push(`   ${it.material || '-'}`);
    const dims: string[] = [];
    if (it.dia) dims.push(`Dia ${it.dia}mm`);
    if (it.thick) dims.push(`Thick ${it.thick}mm`);
    if (it.width) dims.push(`Width ${it.width}mm`);
    if (it.length) dims.push(`Length ${it.length}mm`);
    if (dims.length) lines.push(`   ${dims.join(' x ')}`);
    lines.push(`   Qty: ${it.pcs || 0} pcs | Berat: ${it.berat || 0} kgs | ${it.lokal || '-'}`);
    if (it.estimasi) lines.push(`   Estimasi kebutuhan: ${formatDateID(String(it.estimasi))}`);
  });

  if (d.catatan) {
    lines.push('');
    lines.push(`Catatan: ${d.catatan}`);
  }
  if (d.attachmentCount) {
    lines.push(`Lampiran: ${d.attachmentCount} file (dikirim terpisah)`);
  }
  return lines.join('\n');
}

const COLS = [
  { wch: 4 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 6 }, { wch: 10 }, { wch: 26 },
  { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 24 },
  { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 10 },
];

/** Sheet rows for an RFQ or FUP A — `prefix` labels the No/Tgl columns. */
export function buildPurchaseRequestRows(prefix: string, d: PurchaseRequestDoc): unknown[][] {
  const header = [
    'NO', 'CABANG', `NO ${prefix}`, `TGL ${prefix}`, 'Line', 'GRADE', 'Material',
    'DIA (mm)', 'THICK (mm)', 'WIDTH (mm)', 'LENGTH (mm)', 'PCS', 'BERAT (KGS)', 'CUST',
    'Lokal/Import', 'estimasi kebutuhan', 'CATATAN', 'JUMLAH LAMPIRAN',
  ];
  const aoa: unknown[][] = [header];
  d.items.forEach((it, idx) => {
    aoa.push([
      idx === 0 ? 1 : '', idx === 0 ? d.cabang : '', idx === 0 ? d.no : '', idx === 0 ? d.tgl : '',
      it.line, it.grade, it.material,
      it.dia || '', it.thick || '', it.width || '', it.length || '',
      it.pcs || '', it.berat || '', idx === 0 ? d.customer : '', it.lokal, it.estimasi || '',
      idx === 0 ? d.catatan || '' : '', idx === 0 ? d.attachmentCount ?? '' : '',
    ]);
  });
  return aoa;
}

/** Builds and downloads the sheet. Kept here so RFQ and FUP A stay identical. */
export async function downloadPurchaseRequestExcel(prefix: string, sheetName: string, d: PurchaseRequestDoc, filename: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(buildPurchaseRequestRows(prefix, d));
  ws['!cols'] = COLS;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
