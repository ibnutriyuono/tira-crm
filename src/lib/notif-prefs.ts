/**
 * Notifikasi email — kategori & pengaturan per user (client-safe, dipakai
 * server dan browser). Setiap NotifType masuk satu kategori; per kategori
 * user memilih: langsung (satu email per kejadian), ringkasan (digabung di
 * email harian), atau mati. Notifikasi di dalam CRM tetap muncul apa pun
 * pilihannya.
 */

export type EmailMode = 'langsung' | 'ringkasan' | 'mati';

export interface NotifCategory {
  key: string;
  label: string;
  hint: string;
  def: EmailMode;
  types: string[];
}

export const NOTIF_CATEGORIES: NotifCategory[] = [
  { key: 'rfq', label: 'RFQ / FUP A', hint: 'baru masuk (Purchasing), dijawab, selesai, dibatalkan', def: 'langsung', types: ['rfq_new', 'fupa_new', 'rfq_answered', 'fupa_answered', 'rfq_done', 'fupa_done', 'rfq_cancelled', 'fupa_cancelled'] },
  { key: 'chat', label: 'Diskusi baru di kartu', hint: 'prospek, RFQ, FUP A', def: 'ringkasan', types: ['prospect_chat', 'rfq_chat', 'fupa_chat'] },
  { key: 'fu', label: 'Follow-up hari ini / terlambat', hint: 'jadwal follow-up prospek', def: 'ringkasan', types: ['followup_due', 'followup_overdue'] },
  { key: 'issue', label: 'Masalah pipeline', hint: 'usulan, ditugaskan, perkembangan, eskalasi', def: 'langsung', types: ['issue_proposed', 'issue_new', 'issue_update', 'issue_escalated'] },
  { key: 'trip', label: 'Perjalanan dinas', hint: 'perlu persetujuan, disetujui/ditolak, ikut sebagai peserta', def: 'langsung', types: ['trip_submitted', 'trip_approved', 'trip_rejected', 'trip_scheduled', 'trip_cancelled'] },
  { key: 'target', label: 'Target', hint: 'target cabang perlu dibagi, target Sales ditetapkan', def: 'ringkasan', types: ['target_allocate', 'target_assigned'] },
  { key: 'admin', label: 'Antrian Admin', hint: 'tugas faktur & dokumen PO/DO', def: 'ringkasan', types: ['admin_task'] },
  { key: 'kam', label: 'Key Account lintas cabang', hint: 'prospek/RFQ grup di cabang lain', def: 'mati', types: ['kam_cross_branch'] },
];

export const EMAIL_MODES: { key: EmailMode; label: string }[] = [
  { key: 'langsung', label: 'Langsung' },
  { key: 'ringkasan', label: 'Ringkasan' },
  { key: 'mati', label: 'Tidak' },
];

export const DIGEST_HOURS = ['06.30', '07.00', '07.30', '08.00', '12.00', '17.00'];

/** Batas email langsung per user per hari; sisanya masuk ringkasan. */
export const INSTANT_DAILY_CAP = 20;

export interface NotifPrefs {
  modes: Record<string, EmailMode>;
  /** Jam kirim ringkasan harian "HH.MM" (WIB). */
  jam: string;
  /** "kerja" = Senin–Jumat, "semua" = setiap hari. */
  hari: 'kerja' | 'semua';
}

export function categoryOf(type: string): NotifCategory | undefined {
  return NOTIF_CATEGORIES.find((c) => c.types.includes(type));
}

export function defaultPrefs(): NotifPrefs {
  const modes: Record<string, EmailMode> = {};
  NOTIF_CATEGORIES.forEach((c) => (modes[c.key] = c.def));
  return { modes, jam: '07.00', hari: 'kerja' };
}

export function normalizePrefs(raw: unknown): NotifPrefs {
  const d = defaultPrefs();
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const m = o.modes && typeof o.modes === 'object' ? (o.modes as Record<string, unknown>) : {};
  NOTIF_CATEGORIES.forEach((c) => {
    const v = m[c.key];
    if (v === 'langsung' || v === 'ringkasan' || v === 'mati') d.modes[c.key] = v;
  });
  if (typeof o.jam === 'string' && DIGEST_HOURS.includes(o.jam)) d.jam = o.jam;
  if (o.hari === 'semua' || o.hari === 'kerja') d.hari = o.hari;
  return d;
}

/** Mode email untuk satu jenis notifikasi; jenis yang tidak dikenal = ringkasan. */
export function modeFor(prefs: NotifPrefs, type: string): EmailMode {
  const c = categoryOf(type);
  return c ? prefs.modes[c.key] ?? c.def : 'ringkasan';
}

export function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
