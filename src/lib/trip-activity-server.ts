import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import { cleanIdList, syncTripActivities } from './trip-activity';

/** Peserta perjalanan: user yang ada, tanpa pemilik, maks. 10. */
export async function cleanPeserta(raw: unknown, ownerId: string): Promise<string[]> {
  const ids = cleanIdList(raw, 10).filter((x) => x !== ownerId);
  if (!ids.length) return [];
  const rows = (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })) as { id: string }[];
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((x) => ok.has(x));
}

/** Sinkron Aktivitas Harian dari perjalanan — best-effort, tidak menggagalkan simpan perjalanan. */
export async function syncTripActivitiesSafe(tripId: string) {
  try {
    const r = await syncTripActivities(tripId);
    if (r.created || r.updated || r.deleted) emitCrmEvent('activity:refresh', { tripId });
    return r;
  } catch (err) {
    console.error('[trip] gagal sinkron aktivitas harian', err);
    return null;
  }
}
