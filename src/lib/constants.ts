export const CABANG_LIST = ['BLP', 'MDN', 'SBY', 'PKB', 'CLG', 'BDG', 'MKS', 'CLP', 'PLB', 'PDG', 'DKI', 'BJM', 'SMG'];

export const STATUS_META: Record<number, { label: string; color: string }> = {
  0: { label: 'Sales Activity', color: 'slate' },
  1: { label: 'Permintaan', color: 'steel' },
  2: { label: 'Penawaran Harga', color: 'steel' },
  3: { label: 'Negosiasi', color: 'amber' },
  4: { label: 'PO / Kontrak', color: 'amber' },
  5: { label: 'DO', color: 'green' },
  6: { label: 'Lose Order / Batal', color: 'rust' },
};

export const FUNNEL_STAGES = [1, 2, 3, 4, 5];
export const KANBAN_STATUSES = [0, 1, 2, 3, 4, 5, 6];

export const BULAN_LIST = [
  { v: '01', l: 'Januari' }, { v: '02', l: 'Februari' }, { v: '03', l: 'Maret' }, { v: '04', l: 'April' },
  { v: '05', l: 'Mei' }, { v: '06', l: 'Juni' }, { v: '07', l: 'Juli' }, { v: '08', l: 'Agustus' },
  { v: '09', l: 'September' }, { v: '10', l: 'Oktober' }, { v: '11', l: 'November' }, { v: '12', l: 'Desember' },
];

// Client-safe activity-log labels. Kept here rather than in src/lib/activity.ts
// because that module pulls in Prisma and must stay server-only.
export const ACTIVITY_ACTION_META: Record<string, { label: string; color: string }> = {
  login: { label: 'Login', color: 'steel' },
  login_failed: { label: 'Login Gagal', color: 'rust' },
  logout: { label: 'Logout', color: 'slate' },
  create: { label: 'Tambah', color: 'green' },
  update: { label: 'Ubah', color: 'amber' },
  status_change: { label: 'Ubah Status', color: 'amber' },
  delete: { label: 'Hapus', color: 'rust' },
  import: { label: 'Import', color: 'steel' },
  export: { label: 'Export', color: 'slate' },
  restore: { label: 'Pulihkan', color: 'rust' },
};

export const ACTIVITY_ENTITY_LABEL: Record<string, string> = {
  prospect: 'Prospek',
  customer: 'Customer',
  rfq: 'RFQ',
  user: 'User',
  setting: 'Pengaturan',
  database: 'Database',
  session: 'Sesi',
  vendor: 'Vendor',
  fupa: 'FUP A',
  quotation: 'Penawaran Vendor',
  budget: 'Target Budget',
  chat: 'Chat',
  salesPlan: 'Rencana Penjualan',
  salesActivity: 'Aktivitas Sales',
  activityTarget: 'Target Aktivitas',
  visitTrip: 'Perjalanan Dinas',
};

// Purchasing-side status ladder for RFQ / FUP A, ported from the single-file
// app's PSTATUS_META. Independent of the sales-side STATUS_META above: a
// prospect can sit at "Negosiasi" while its RFQ is already "PO Diterbitkan".
export const PSTATUS_META: Record<number, { label: string; color: string }> = {
  0: { label: 'Baru', color: 'slate' },
  1: { label: 'Diminta Penawaran', color: 'steel' },
  2: { label: 'Penawaran Masuk', color: 'amber' },
  3: { label: 'PO Diterbitkan', color: 'steel' },
  4: { label: 'Selesai', color: 'green' },
  5: { label: 'Dibatalkan', color: 'rust' },
};

export const PSTATUS_BARU = 0;
export const PSTATUS_DIMINTA = 1;
export const PSTATUS_MASUK = 2;
export const PSTATUS_PO = 3;

// Stage-weighted pipeline value, used by the forecast panel.
export const STAGE_PROBABILITY: Record<number, number> = {
  0: 0, 1: 0.1, 2: 0.3, 3: 0.6, 4: 0.9, 5: 1, 6: 0,
};

// Prospects above these values get a highlighted row / card, so the big
// deals stand out in a long list.
export const VALUE_HL_GREEN = 1_000_000_000;
export const VALUE_HL_YELLOW = 3_000_000_000;

// A prospect with no movement for this long is flagged as aging.
export const AGING_THRESHOLD_DAYS = 14;

export const ROLE_LABELS: Record<string, string> = {
  purchasing: 'Purchasing',
  purchasing05: 'PIC Line 05',
  admin: 'Admin',
  gm: 'GM',
  rm: 'RM',
  bm: 'BM',
  sales: 'Sales',
};

export const BROADCAST_ROLE_OPTIONS = [
  { v: 'sales', l: 'Sales' },
  { v: 'bm', l: 'BM (Branch Manager)' },
  { v: 'rm', l: 'RM (Regional Manager)' },
  { v: 'gm', l: 'GM (General Manager)' },
  { v: 'purchasing', l: 'Purchasing' },
  { v: 'purchasing05', l: 'PIC Line 05 (Purchasing fabrikasi)' },
  { v: 'admin', l: 'Admin' },
];

export const RFQ_LOKAL_OPTIONS = [
  { v: 'LOKAL', l: 'Lokal' },
  { v: 'IMPORT', l: 'Import' },
  { v: 'LOKAL ATAU IMPORT', l: 'Lokal atau Import' },
];

/**
 * Per-file upload ceiling for RFQ / FUP A attachments, shared by the upload
 * route that enforces it and the form labels that advertise it — the two drifted
 * apart once before, when the labels still quoted the prototype's 1.5MB base64
 * limit long after uploads had moved to object storage.
 *
 * There is deliberately no file-count limit: pick one with the business first,
 * and enforce it server-side rather than only stating it in a label.
 */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

// --- Aktivitas harian Sales ---------------------------------------------
export type ActivityTipe = 'kunjungan' | 'telepon' | 'meeting' | 'dokumen';

/** `short` is for table headers and one-line summaries. */
export const ACTIVITY_TYPES: { key: ActivityTipe; label: string; short: string; unit: string }[] = [
  { key: 'kunjungan', label: 'Kunjungan customer', short: 'Kunjungan', unit: 'kunjungan' },
  { key: 'telepon', label: 'Telepon / WhatsApp', short: 'Telepon/WA', unit: 'kontak' },
  { key: 'meeting', label: 'Meeting / presentasi', short: 'Meeting', unit: 'meeting' },
  { key: 'dokumen', label: 'Kirim penawaran / dokumen', short: 'Dokumen', unit: 'dokumen' },
];

/**
 * Target bulanan per jenis aktivitas bila atasan belum menetapkannya untuk SE
 * itu. Angka awal ini hanya titik mulai (BELUM ditetapkan oleh manajemen) --
 * UI menandainya "default" dan atasan menggantinya per SE per bulan.
 */
export const DEFAULT_ACTIVITY_TARGETS: Record<ActivityTipe, number> = {
  kunjungan: 20,
  telepon: 40,
  meeting: 8,
  dokumen: 10,
};

/** Status pipeline yang bisa dituju tombol "Masukkan ke Pipeline". */
export const ACTIVITY_CONVERT_STATUSES = [1, 2, 4] as const;
