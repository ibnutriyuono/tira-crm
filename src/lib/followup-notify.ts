import { KANAL_LABEL, type Kanal } from './activity-contact';
import { ACTIVITY_TYPES } from './constants';
import { bmUserIds, notify, seUserIds } from './notify';
import { prisma } from './prisma';

/** Rencana yang belum dikerjakan sampai H+2 dianggap terlambat. */
export const OVERDUE_DAYS = 2;
/** Rencana lebih lama dari ini tidak lagi diberi notifikasi (cegah banjir saat pertama dipasang). */
const LOOKBACK_DAYS = 14;
/** Sweep paling sering sekali per 5 menit per proses server. */
const THROTTLE_MS = 5 * 60 * 1000;

let lastSweep = 0;
let running: Promise<void> | null = null;

/** Tanggal hari ini di Jakarta (YYYY-MM-DD), tidak bergantung zona waktu server. */
export function jakartaToday(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmt = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

type PlanRow = { id: string; tanggal: string; se: string; cabang: string | null; tipe: string; customer: string; keterangan: string | null; kanal?: string | null; sumber?: string | null };

/**
 * Notifikasi rencana follow-up Aktivitas Harian (dari hasil kontak maupun
 * jadwal follow-up prospek):
 *  - hari H  -> Sales pemilik rencana ("Follow-up hari ini");
 *  - H+2 dan belum dikerjakan -> Sales + BM cabangnya ("Follow-up terlambat").
 * Tiap jenis dikirim sekali per rencana per penerima. Aplikasi tidak punya
 * penjadwal, jadi sweep ini dipanggil saat user membuka CRM / tab Notifikasi.
 */
export async function sweepFollowUpNotifications(opts: { force?: boolean; today?: string } = {}): Promise<void> {
  if (!opts.force && Date.now() - lastSweep < THROTTLE_MS) return running ?? undefined;
  if (running) return running;
  lastSweep = Date.now();
  running = (async () => {
    try {
      const today = opts.today || jakartaToday();
      const overdueTo = addDaysYmd(today, -OVERDUE_DAYS);
      const plans = (await prisma.salesActivity.findMany({
        where: { status: 'rencana', tanggal: { gte: addDaysYmd(today, -LOOKBACK_DAYS), lte: today } },
        select: { id: true, tanggal: true, se: true, cabang: true, tipe: true, customer: true, keterangan: true, kanal: true, sumber: true },
      })) as PlanRow[];
      const due = plans.filter((p) => p.tanggal === today);
      const late = plans.filter((p) => p.tanggal <= overdueTo);
      if (!due.length && !late.length) return;

      const sent = await prisma.notification.findMany({
        where: { type: { in: ['followup_due', 'followup_overdue'] }, entity: 'activity', entityId: { in: [...due, ...late].map((p) => p.id) } },
        select: { type: true, entityId: true, userId: true },
      });
      const seen = new Set(sent.map((n) => `${n.type}|${n.entityId}|${n.userId}`));
      const fresh = (type: string, id: string, ids: string[]) => ids.filter((u) => !seen.has(`${type}|${id}|${u}`));

      const seCache = new Map<string, string[]>();
      const bmCache = new Map<string, string[]>();
      const owners = async (se: string) => {
        const k = se.toUpperCase();
        if (!seCache.has(k)) seCache.set(k, await seUserIds(se));
        return seCache.get(k)!;
      };
      const bms = async (cab: string | null) => {
        const k = (cab || '').toUpperCase();
        if (!bmCache.has(k)) bmCache.set(k, await bmUserIds(cab));
        return bmCache.get(k)!;
      };
      const what = (p: PlanRow) => {
        const tipe = ACTIVITY_TYPES.find((t) => t.key === p.tipe)?.label || p.tipe;
        const via = p.kanal ? ` via ${KANAL_LABEL[p.kanal as Kanal] || p.kanal}` : '';
        return `${tipe}${via}`;
      };

      for (const p of due) {
        const ids = fresh('followup_due', p.id, await owners(p.se));
        await notify({
          userIds: ids,
          type: 'followup_due',
          entity: 'activity',
          entityId: p.id,
          title: `Follow-up hari ini: ${p.customer}`,
          message: `${what(p)}. ${(p.keterangan || '').slice(0, 140)}`.trim(),
        });
      }
      for (const p of late) {
        const ids = fresh('followup_overdue', p.id, [...(await owners(p.se)), ...(await bms(p.cabang))]);
        const days = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${p.tanggal}T00:00:00Z`).getTime()) / 86400000);
        await notify({
          userIds: ids,
          type: 'followup_overdue',
          entity: 'activity',
          entityId: p.id,
          title: `Follow-up terlambat ${days} hari: ${p.customer}`,
          message: `Rencana ${what(p)} tanggal ${fmt(p.tanggal)} oleh ${p.se}${p.cabang ? ` (${p.cabang})` : ''} belum dikerjakan.`,
        });
      }
    } catch (err) {
      console.error('[followup] gagal mengirim notifikasi follow-up', err);
    } finally {
      running = null;
    }
  })();
  return running;
}
