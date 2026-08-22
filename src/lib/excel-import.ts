import { num } from './format';

export const PROSPECT_COL_ALIASES: Record<string, string[]> = {
  reg: ['REG'],
  cabang: ['CABANG'],
  se: ['SE'],
  customer: ['CUSTOMER'],
  phone: ['NO WHATSAPP', 'NO HP', 'WHATSAPP', 'TELEPON', 'PHONE', 'NO TELP', 'NO WA'],
  tglPenawaran: ['TGL PENAWARAN'],
  tglPO: ['TGL PO'],
  tglDelivery: ['TGL DELIVERY'],
  line: ['LINE'],
  uraian: ['URAIAN PRODUCT', 'URAIAN'],
  qty: ['QTY PCS', 'QTY'],
  value: ['VALUE RP', 'VALUE'],
  kondisiStock: ['KONDISI STOCK'],
  keterangan: ['KETERANGAN'],
  status: ['STATUS'],
  penawaranTerkirim: ['STATUS PENAWARAN', 'PENAWARAN TERKIRIM', 'PENAWARAN'],
};
export const PROSPECT_FIELD_TYPES: Record<string, string> = {
  reg: 'numOrBlank', cabang: 'upper', se: 'upper', customer: 'string', phone: 'string',
  tglPenawaran: 'date', tglPO: 'date', tglDelivery: 'date', line: 'string', uraian: 'string',
  qty: 'number', value: 'number', kondisiStock: 'string', keterangan: 'string', status: 'number',
  penawaranTerkirim: 'bool',
};

export const CUSTOMER_COL_ALIASES: Record<string, string[]> = {
  name: ['NAMA CUSTOMER', 'CUSTOMER', 'NAMA'],
  cabang: ['CABANG'],
  pic: ['PIC', 'KONTAK', 'CONTACT PERSON', 'NAMA PIC'],
  phone: ['NO TELP', 'TELEPON', 'NO HP', 'NO WHATSAPP', 'NO WA', 'PHONE'],
  email: ['EMAIL', 'E MAIL'],
  address: ['ALAMAT', 'ADDRESS'],
  catatan: ['CATATAN', 'NOTES'],
};
export const CUSTOMER_FIELD_TYPES: Record<string, string> = { name: 'string', cabang: 'upper', pic: 'string', phone: 'string', email: 'string', address: 'string', catatan: 'string' };

export const VENDOR_COL_ALIASES: Record<string, string[]> = {
  nama: ['NAMA VENDOR', 'VENDOR', 'NAMA', 'SUPPLIER', 'NAMA SUPPLIER'],
  pic: ['PIC', 'KONTAK', 'CONTACT PERSON', 'NAMA PIC'],
  wa: ['NO WHATSAPP', 'NO WA', 'WHATSAPP', 'NO TELP', 'TELEPON', 'NO HP', 'PHONE'],
  email: ['EMAIL', 'E MAIL'],
  kategori: ['KATEGORI', 'CATEGORY', 'JENIS', 'PRODUK'],
  alamat: ['ALAMAT', 'ADDRESS'],
  catatan: ['CATATAN', 'NOTES', 'KETERANGAN'],
};
export const VENDOR_FIELD_TYPES: Record<string, string> = { nama: 'string', pic: 'string', wa: 'string', email: 'string', kategori: 'string', alamat: 'string', catatan: 'string' };

function normHeader(v: unknown): string {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function excelSerialToISO(n: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function toISODate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

export interface ParseResult {
  records?: Record<string, unknown>[];
  error?: string;
}

export function parseSheetGeneric(aoa: unknown[][], colAliases: Record<string, string[]>, fieldTypes: Record<string, string>, requiredKey: string, requiredLabel: string): ParseResult {
  let headerRowIdx = -1;
  const scanLimit = Math.min(25, aoa.length);
  const reqAliases = colAliases[requiredKey];
  for (let i = 0; i < scanLimit; i++) {
    const row = (aoa[i] || []).map(normHeader);
    if (reqAliases.some((a) => row.includes(a))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return { error: `Kolom "${requiredLabel}" tidak ditemukan pada 25 baris pertama sheet ini.` };
  const header = (aoa[headerRowIdx] || []).map(normHeader);
  const findCol = (aliases: string[]) => {
    for (const a of aliases) {
      const idx = header.indexOf(a);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idxMap: Record<string, number> = {};
  Object.keys(colAliases).forEach((k) => (idxMap[k] = findCol(colAliases[k])));
  if (idxMap[requiredKey] === -1) return { error: `Kolom "${requiredLabel}" tidak dapat dipetakan.` };

  const records: Record<string, unknown>[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row) continue;
    const reqVal = idxMap[requiredKey] > -1 ? row[idxMap[requiredKey]] : '';
    if (reqVal === undefined || reqVal === null || String(reqVal).trim() === '') continue;
    const get = (k: string) => (idxMap[k] > -1 ? row[idxMap[k]] : '');
    const rec: Record<string, unknown> = {};
    Object.keys(fieldTypes).forEach((k) => {
      const v = get(k);
      const type = fieldTypes[k];
      if (type === 'number') rec[k] = num(v);
      else if (type === 'numOrBlank') {
        const n = num(v);
        rec[k] = n || '';
      } else if (type === 'date') rec[k] = toISODate(v);
      else if (type === 'upper') rec[k] = String(v || '').trim().toUpperCase();
      else if (type === 'bool') rec[k] = ['YA', 'TERKIRIM', '1', 'TRUE', 'SENT'].includes(String(v || '').trim().toUpperCase());
      else rec[k] = String(v || '').trim();
    });
    records.push(rec);
  }
  return { records };
}

export function parseSheetToRecords(aoa: unknown[][]): ParseResult {
  return parseSheetGeneric(aoa, PROSPECT_COL_ALIASES, PROSPECT_FIELD_TYPES, 'customer', 'CUSTOMER');
}
export function parseSheetToCustomerRecords(aoa: unknown[][]): ParseResult {
  return parseSheetGeneric(aoa, CUSTOMER_COL_ALIASES, CUSTOMER_FIELD_TYPES, 'name', 'NAMA CUSTOMER');
}
export function parseSheetToVendorRecords(aoa: unknown[][]): ParseResult {
  return parseSheetGeneric(aoa, VENDOR_COL_ALIASES, VENDOR_FIELD_TYPES, 'nama', 'NAMA VENDOR');
}
