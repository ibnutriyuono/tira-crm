import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HASIL_LABEL, KANAL_BY_TIPE, contactErrors, needsHasil, type Hasil } from './activity-contact';
import type { ActivityPic } from './types';

export interface ActivityExtras {
  kanal: string | null;
  hasil: string | null;
  langkah: string | null;
  followUp: string | null;
  lat: number | null;
  lng: number | null;
  akurasi: number | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Ambil & periksa saluran / hasil / langkah / follow-up / lokasi dari body; error = pesan untuk 400. */
export function parseActivityExtras(body: Record<string, unknown> | null, tipe: string, tanggal: string, pics: ActivityPic[]): { extras: ActivityExtras } | { error: string } {
  const kanals = KANAL_BY_TIPE[tipe];
  const kanal = kanals ? String(body?.kanal || '') : '';
  const hasil = needsHasil(tipe, kanal) ? String(body?.hasil || '') : '';
  const followUp = hasil && hasil !== 'tersambung' ? String(body?.followUp || '') : '';
  const langkah = String(body?.langkah || '').trim().slice(0, 300);
  const errs = contactErrors({ tipe, kanal, hasil, followUp, langkah, pics });
  if (errs.length) return { error: errs.join(' ') };
  if (followUp) {
    const max = new Date(`${tanggal}T00:00:00Z`);
    max.setUTCDate(max.getUTCDate() + 90);
    if (followUp < tanggal || followUp > max.toISOString().slice(0, 10)) return { error: 'Tanggal follow-up harus antara tanggal aktivitas dan 90 hari sesudahnya.' };
  }
  let lat = num(body?.lat);
  let lng = num(body?.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) lat = lng = null;
  return {
    extras: {
      kanal: kanal || null,
      hasil: hasil || null,
      langkah: langkah || null,
      followUp: followUp || null,
      lat,
      lng,
      akurasi: lat === null ? null : num(body?.akurasi),
    },
  };
}

type ActRow = { id: string; tanggal: string; se: string; cabang: string | null; reg: number | null; tipe: string; customer: string; keterangan: string | null; followUpId?: string | null };

/**
 * Hasil kontak belum tersambung -> satu baris "rencana" (sumber "aktivitas")
 * pada tanggal follow-up, terhubung lewat followUpId. Diubah lagi ->
 * rencana itu dipindah; menjadi tersambung -> rencana yang belum dikerjakan dihapus.
 */
export async function syncActivityFollowUp(act: ActRow, extras: ActivityExtras, pics: ActivityPic[], createdBy: string): Promise<string | null> {
  const prev = act.followUpId ? await prisma.salesActivity.findUnique({ where: { id: act.followUpId } }) : null;
  const open = prev && prev.status === 'rencana' ? prev : null;
  if (!extras.followUp) {
    if (open) await prisma.salesActivity.delete({ where: { id: open.id } });
    if (act.followUpId) await prisma.salesActivity.update({ where: { id: act.id }, data: { followUpId: null } });
    return null;
  }
  const note = `Follow-up (${HASIL_LABEL[extras.hasil as Hasil] || extras.hasil}) dari aktivitas ${act.tanggal}${act.keterangan ? ` — ${act.keterangan}` : ''}`.slice(0, 500);
  const contacted = pics.filter((p) => p.dihubungi);
  const data = {
    tanggal: extras.followUp,
    tipe: act.tipe,
    customer: act.customer,
    keterangan: note,
    kanal: extras.kanal,
    pics: (contacted.length ? contacted : pics) as unknown as Prisma.InputJsonValue,
  };
  if (open) {
    await prisma.salesActivity.update({ where: { id: open.id }, data });
    return open.id;
  }
  const plan = await prisma.salesActivity.create({
    data: { ...data, se: act.se, cabang: act.cabang, reg: act.reg, status: 'rencana', sumber: 'aktivitas', createdBy },
  });
  await prisma.salesActivity.update({ where: { id: act.id }, data: { followUpId: plan.id } });
  return plan.id;
}
