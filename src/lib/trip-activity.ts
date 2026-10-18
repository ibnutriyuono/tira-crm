import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { activityOwner } from './sales-activity';
import { normalizeCustomerName } from './kam';
import { parsePicText } from './customer-sync';
import type { TripVisit } from './types';

/**
 * Perjalanan Dinas -> Aktivitas Harian.
 *
 * Tiap kunjungan berrealisasi (realisasi terisi, hasil bukan "Tidak jadi
 * dikunjungi") pada perjalanan disetujui/selesai menjadi "Kunjungan customer":
 *  - satu baris untuk setiap personil yang ikut (semua role punya Aktivitas
 *    Harian, lihat activityOwner); Sales/BM masuk KPI masing-masing, RM/GM
 *    tercatat di Aktivitas Harian-nya sendiri;
 *  - bila tidak ada Sales/BM yang ikut: juga atas nama Sales pemilik customer
 *    di cabang tujuan (prospek terakhir customer itu di cabang tsb), supaya
 *    kunjungan atasan ke customer tetap terlihat di KPI Sales-nya.
 * Baris bertanda sumber "perjalanan" + tripId/tripVisitId dan selalu
 * disinkron ulang dari perjalanan (perjalanan batal -> baris dihapus).
 */

type UserLite = { id: string; name: string; username: string; role: string; se: string | null; cabang: string | null; reg: number | null };
type TripLite = { id: string; ownerId: string; ownerName: string; cabang: string; reg: number | null; tglBerangkat: string; status: string; visits: unknown; pesertaIds: unknown };

export const TRIP_SOURCE = 'perjalanan';

export function cleanIdList(v: unknown, max = 20): string[] {
  const list = Array.isArray(v) ? v : [];
  return Array.from(new Set(list.map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean))).slice(0, max);
}

/** Personil yang tercatat ikut ke satu kunjungan (default: pemilik + semua peserta). */
export function visitPersonil(trip: Pick<TripLite, 'ownerId' | 'pesertaIds'>, v: TripVisit): string[] {
  const peserta = cleanIdList(trip.pesertaIds);
  return Array.isArray(v.personilIds) && v.personilIds.length ? cleanIdList(v.personilIds) : [trip.ownerId, ...peserta];
}

/** Kunjungan yang dicatat ke Aktivitas Harian. */
export const visitCounts = (v: TripVisit) => !!(v.realisasi || '').trim() && v.hasil !== 'batal';

/** Sales pemilik customer di cabang tujuan: SE prospek terakhir customer itu di cabang tsb. */
async function salesOwnerOf(customer: string, cabang: string): Promise<string | null> {
  const key = normalizeCustomerName(customer);
  if (!key) return null;
  const rows = (await prisma.prospect.findMany({
    where: { cabang: { equals: cabang, mode: 'insensitive' }, se: { not: null } },
    select: { customer: true, se: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  })) as { customer: string; se: string | null }[];
  const hit = rows.find((r) => normalizeCustomerName(r.customer) === key && r.se);
  return hit?.se ? hit.se.trim().toUpperCase() : null;
}

export async function syncTripActivities(tripId: string): Promise<{ created: number; updated: number; deleted: number }> {
  const trip = (await prisma.visitTrip.findUnique({ where: { id: tripId } })) as unknown as TripLite | null;
  const existing = (await prisma.salesActivity.findMany({ where: { tripId } })) as { id: string; tripVisitId: string | null; se: string }[];
  const keyOf = (visitId: string, se: string) => `${visitId}|${se.toUpperCase()}`;
  const want = new Map<string, Record<string, unknown>>();

  if (trip && (trip.status === 'disetujui' || trip.status === 'selesai')) {
    const visits = (Array.isArray(trip.visits) ? trip.visits : []) as TripVisit[];
    const allIds = Array.from(new Set(visits.filter(visitCounts).flatMap((v) => visitPersonil(trip, v))));
    const users = (allIds.length
      ? await prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true, username: true, role: true, se: true, cabang: true, reg: true } })
      : []) as UserLite[];
    const byId = new Map(users.map((u) => [u.id, u]));

    for (const v of visits.filter(visitCounts)) {
      const ikut = visitPersonil(trip, v).map((id) => byId.get(id)).filter((u): u is UserLite => !!u);
      const owners = ikut.map((u) => ({ u, se: activityOwner(u) })).filter((x): x is { u: UserLite; se: string } => !!x.se);
      const targets: { se: string; uid: string | null }[] = owners.map((x) => ({ se: x.se.toUpperCase(), uid: x.u.id }));
      if (!ikut.some((u) => u.role === 'sales' || u.role === 'bm')) {
        const se = await salesOwnerOf(v.customer, trip.cabang);
        if (se && !targets.some((t) => t.se === se)) targets.push({ se, uid: null });
      }
      for (const t of targets) {
        const others = ikut.filter((u) => u.id !== t.uid).map((u) => u.name);
        const pics = parsePicText(v.pic).map((p) => ({ nama: p.nama, jabatan: p.jabatan || '' }));
        want.set(keyOf(v.id, t.se), {
          tanggal: v.tanggal || trip.tglBerangkat,
          se: t.se,
          cabang: trip.cabang,
          reg: trip.reg,
          tipe: 'kunjungan',
          customer: v.customer,
          keterangan: (v.realisasi || '').trim().slice(0, 2000),
          pics: pics as unknown as Prisma.InputJsonValue,
          status: 'selesai',
          sumber: TRIP_SOURCE,
          tripId: trip.id,
          tripVisitId: v.id,
          pendamping: others.length ? others.join(', ').slice(0, 500) : null,
          createdBy: trip.ownerName,
        });
      }
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const seen = new Set<string>();
  for (const a of existing) {
    const k = keyOf(a.tripVisitId || '', a.se);
    const data = want.get(k);
    if (data && !seen.has(k)) {
      seen.add(k);
      await prisma.salesActivity.update({ where: { id: a.id }, data: data as never });
      updated++;
    } else {
      await prisma.salesActivity.delete({ where: { id: a.id } });
      deleted++;
    }
  }
  for (const [k, data] of want) {
    if (seen.has(k)) continue;
    await prisma.salesActivity.create({ data: data as never });
    created++;
  }
  return { created, updated, deleted };
}
