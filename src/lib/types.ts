export type Role = 'admin' | 'gm' | 'rm' | 'bm' | 'sales' | 'purchasing';

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
  /** Kg per piece. With hargaKg it derives the unit price. */
  beratPc: number;
  /** Rp per kg. */
  hargaKg: number;
  /** Flat unit price, used when beratPc/hargaKg aren't filled in. */
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
  /** DO invoiced — splits Omzet (true) from GIT (false). */
  terfaktur: boolean;
  statusChangedAt: string;
  qcdQuality: string | null;
  qcdCost: string | null;
  qcdDelivery: string | null;
  qcdKompetitor: string | null;
  qcdCatatan: string | null;
  followUpAt: string | null;
  followUpNote: string | null;
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
  // Purchasing's answer, filled in from the purchasing module. All of it lives
  // inside the `items` JSON column, so adding fields here needs no migration —
  // older rows simply have them undefined and render as '-'.
  hargaPurchasing?: number;
  currency?: string;
  uom?: string;
  deliveryTime?: string;
  /** Country of origin. Briefly relabelled "Keterangan" until `note` existed. */
  coo?: string;
  note?: string;
  /**
   * Per-material "cannot be quoted". Supersedes the document-level
   * Rfq.noQuote / Fupa.noQuote flag, which is still read as a fallback for
   * records marked before this became per-material.
   */
  noQuote?: boolean;
}

export interface Quotation {
  id: string;
  vendorId: string;
  vendorNama?: string;
  rfqId: string | null;
  fupaId: string | null;
  tglDiminta: string | null;
  channel: string | null;
  harga: number;
  leadTime: number;
  catatan: string | null;
  isWinner: boolean;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The two document types the purchasing module works on. */
export type PurchDocType = 'RFQ' | 'FUPA';

export interface Fupa {
  id: string;
  noFupa: string | null;
  tglFupa: string | null;
  sourceRfqId: string | null;
  sourceNoRfq: string | null;
  cabang: string | null;
  reg: number | null;
  customer: string | null;
  requestedBy: string | null;
  prospectId: string | null;
  items: RfqItem[];
  catatan: string | null;
  status: 'Draft' | 'Terkirim' | 'Selesai';
  purchStatus: number;
  purchNotes: string | null;
  purchJawaban: string | null;
  sentToPurchasingAt: string | null;
  openedByPurchasingAt: string | null;
  noQuote: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  jawabanFupaDikirim: boolean;
  jawabanFupaAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Rfq {
  id: string;
  noRfq: string | null;
  tglRfq: string | null;
  cabang: string | null;
  reg: number | null;
  customer: string | null;
  requestedBy: string | null;
  prospectId: string | null;
  items: RfqItem[];
  catatan: string | null;
  status: 'Draft' | 'Terkirim' | 'Selesai';
  purchStatus: number;
  fupaId: string | null;
  sentToPurchasingAt: string | null;
  openedByPurchasingAt: string | null;
  noQuote: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  jawabanRfqDikirim: boolean;
  jawabanRfqAt: string | null;
  purchNotes: string | null;
  purchJawaban: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  nama: string;
  pic: string | null;
  wa: string | null;
  email: string | null;
  kategori: string | null;
  alamat: string | null;
  catatan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  rfqId: string | null;
  fupaId: string | null;
  name: string;
  type: string | null;
  size: number;
  key: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface RosterUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  cabang: string | null;
}

export type ItemEntity = 'prospect' | 'rfq' | 'fupa';

export interface ItemChatMessage {
  id: string;
  entity: ItemEntity;
  entityId: string;
  author: string;
  authorUsername: string;
  role: string | null;
  text: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  author: string;
  authorUsername: string;
  role: string | null;
  text: string;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  type: 'dm' | 'group' | 'broadcast';
  name: string | null;
  members: string[];
  createdBy: string;
  updatedAt: string;
  lastMessage: { text: string; author: string; createdAt: string } | null;
  unread: number;
}

export interface BudgetTarget {
  id: string;
  cabang: string;
  periode: string;
  amount: number;
  grossMarginTarget: number | null;
  grossMarginResult: number | null;
}

export type NotificationType =
  | 'rfq_new'
  | 'fupa_new'
  | 'rfq_answered'
  | 'fupa_answered'
  | 'rfq_done'
  | 'fupa_done'
  | 'rfq_chat'
  | 'fupa_chat'
  | 'rfq_cancelled'
  | 'fupa_cancelled';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  entity: 'rfq' | 'fupa';
  entityId: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface SalesPlanItem {
  line: string;
  uraian: string;
  qty: number | string;
  harga: number | string;
  /** Set only when this row was pulled in via "Ambil dari Prospek" — the
   * source Prospect.id, kept so a prospect can be traced across every
   * period it was planned for (see buildProspectStarCounts in reports.ts).
   * Manually-typed rows never have this. */
  sourceProspectId?: string | null;
}

export interface SalesPlan {
  id: string;
  periode: string;
  se: string;
  cabang: string | null;
  reg: number | null;
  items: SalesPlanItem[];
  value: number;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchasingContact {
  wa: string;
  email: string;
}

export type Klasifikasi = 'Aktif' | 'Won' | 'Lost' | 'Activity';

export type ActivityAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'create'
  | 'update'
  | 'status_change'
  | 'delete'
  | 'import'
  | 'export'
  | 'restore';

export type ActivityEntity =
  | 'prospect'
  | 'customer'
  | 'rfq'
  | 'user'
  | 'setting'
  | 'database'
  | 'session'
  | 'vendor'
  | 'fupa'
  | 'quotation'
  | 'budget'
  | 'salesPlan'
  | 'chat';

export type ActivityChanges = Record<string, { label: string; from: unknown; to: unknown }>;

export interface ActivityLog {
  id: string;
  createdAt: string;
  userId: string | null;
  username: string;
  actorName: string;
  role: Role | null;
  actorCabang: string | null;
  actorReg: number | null;
  action: ActivityAction;
  entity: ActivityEntity;
  entityId: string | null;
  summary: string;
  changes: ActivityChanges | null;
  ip: string | null;
}
