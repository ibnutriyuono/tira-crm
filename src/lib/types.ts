export type Role = 'admin' | 'gm' | 'rm' | 'bm' | 'sales';

export interface SafeUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  se: string | null;
  cabang: string | null;
  reg: number | null;
}

export interface Material {
  line: string;
  uraian: string;
  qty: number;
  harga: number;
}

export interface Prospect {
  id: string;
  reg: number | null;
  cabang: string | null;
  se: string | null;
  customer: string;
  phone: string | null;
  tglPenawaran: string | null;
  tglPO: string | null;
  tglDelivery: string | null;
  line: string | null;
  uraian: string | null;
  qty: number;
  value: number;
  materials: Material[];
  kondisiStock: string | null;
  keterangan: string | null;
  status: number;
  penawaranTerkirim: boolean;
  qcdQuality: string | null;
  qcdCost: string | null;
  qcdDelivery: string | null;
  qcdKompetitor: string | null;
  qcdCatatan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  cabang: string | null;
  pic: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  catatan: string | null;
}

export interface RfqItem {
  line: string;
  grade: string;
  material: string;
  dia: number | string;
  thick: number | string;
  width: number | string;
  length: number | string;
  pcs: number | string;
  berat: number | string;
  lokal: string;
  estimasi: string;
}

export interface Rfq {
  id: string;
  noRfq: string | null;
  tglRfq: string | null;
  cabang: string | null;
  customer: string | null;
  requestedBy: string | null;
  prospectId: string | null;
  items: RfqItem[];
  status: 'Draft' | 'Terkirim' | 'Selesai';
  createdAt: string;
  updatedAt: string;
}

export interface PurchasingContact {
  wa: string;
  email: string;
}

export type Klasifikasi = 'Aktif' | 'Won' | 'Lost';
