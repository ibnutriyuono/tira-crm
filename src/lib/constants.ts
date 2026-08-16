export const CABANG_LIST = ['BLP', 'MDN', 'SBY', 'PKB', 'CLG', 'BDG', 'MKS', 'CLP', 'PLB', 'PDG', 'DKI', 'BJM', 'SMG'];

export const STATUS_META: Record<number, { label: string; color: string }> = {
  0: { label: 'Belum Ditentukan', color: 'slate' },
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
};

export const RFQ_LOKAL_OPTIONS = [
  { v: 'LOKAL', l: 'Lokal' },
  { v: 'IMPORT', l: 'Import' },
  { v: 'LOKAL ATAU IMPORT', l: 'Lokal atau Import' },
];
