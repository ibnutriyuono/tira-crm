import type { Prisma } from '@prisma/client';
import { getPrimaryPic } from './format';
import { prisma } from './prisma';
import { activityOwner } from './sales-activity';
import { jakartaToday } from './ticker';
import type { CustomerPic, SafeUser } from './types';

/**
 * Follow-up -> Aktivitas Harian, automatically:
 * - a scheduled follow-up (Prospect.followUpAt) is kept as ONE "rencana"
 *   activity on that date for the prospect's SE (moved when rescheduled,
 *   removed when the schedule is cleared);
 * - a follow-up actually done ("Buka WhatsApp") is logged as a "selesai"
 *   Telepon/WhatsApp activity for whoever did it, today. A due plan is
 *   turned into that realisation instead of leaving both.
 * Rencana rows don't count in KPI Aktivitas; only what was done does.
 */

export const FOLLOWUP_SOURCE = 'followup';

interface ProspectLike {
  id: string;
  customer: string;
  se: string | null;
  cabang: string | null;
  reg: number | null;
  followUpAt: string | null;
  followUpNote: string | null;
}

export async function picsFor(customer: string): Promise<{ nama: string; jabatan: string }[]> {
  const c = await prisma.customer.findFirst({ where: { name: { equals: customer.trim(), mode: 'insensitive' } } });
  if (!c) return [];
  const p = getPrimaryPic({ pics: (Array.isArray(c.pics) ? c.pics : []) as unknown as CustomerPic[], pic: c.pic, phone: c.phone, email: c.email });
  return p?.nama ? [{ nama: p.nama, jabatan: p.jabatan || '' }] : [];
}

/** Owner of a prospect's planned follow-up: its SE, else whoever scheduled it (Sales/BM). */
function planOwner(user: SafeUser, p: ProspectLike): string | null {
  return (p.se || '').trim().toUpperCase() || activityOwner(user);
}

/** Keep the "rencana" activity in step with the prospect's follow-up schedule. */
export async function syncFollowUpPlan(user: SafeUser, p: ProspectLike): Promise<void> {
  const pending = await prisma.salesActivity.findMany({ where: { prospectId: p.id, status: 'rencana', sumber: FOLLOWUP_SOURCE } });
  if (!p.followUpAt) {
    if (pending.length) await prisma.salesActivity.deleteMany({ where: { id: { in: pending.map((a) => a.id) } } });
    return;
  }
  const se = planOwner(user, p);
  if (!se) return;
  const keterangan = `Rencana follow-up${p.followUpNote ? `: ${p.followUpNote}` : ''}`;
  const [keep, ...extra] = pending;
  if (extra.length) await prisma.salesActivity.deleteMany({ where: { id: { in: extra.map((a) => a.id) } } });
  if (keep) {
    await prisma.salesActivity.update({ where: { id: keep.id }, data: { tanggal: p.followUpAt, se, customer: p.customer, keterangan } });
    return;
  }
  await prisma.salesActivity.create({
    data: {
      tanggal: p.followUpAt,
      se,
      cabang: p.cabang,
      reg: p.reg,
      tipe: 'telepon',
      customer: p.customer,
      keterangan,
      pics: (await picsFor(p.customer)) as unknown as Prisma.InputJsonValue,
      prospectId: p.id,
      status: 'rencana',
      sumber: FOLLOWUP_SOURCE,
      createdBy: user.name || user.username,
    },
  });
}

/**
 * Log a follow-up that was just done. Returns whether it was logged (only
 * Sales/BM have an Aktivitas Harian) and, for a prospect whose schedule was
 * due, that the schedule was fulfilled (followUpAt cleared).
 */
export async function logFollowUpDone(
  user: SafeUser,
  target: { prospect?: ProspectLike; customer?: { name: string; cabang: string | null } },
  channel = 'WhatsApp',
  /** A specific "rencana" row being completed (from Aktivitas Harian), even before its date. */
  planId?: string,
): Promise<{ logged: boolean; scheduleCleared: boolean }> {
  const owner = activityOwner(user);
  const today = jakartaToday();
  const p = target.prospect;
  const customer = p?.customer || target.customer?.name || '';
  if (!customer) return { logged: false, scheduleCleared: false };

  const chosen = planId ? await prisma.salesActivity.findFirst({ where: { id: planId, status: 'rencana', sumber: FOLLOWUP_SOURCE } }) : null;
  let scheduleCleared = false;
  if (p?.followUpAt && (p.followUpAt <= today || (chosen && chosen.prospectId === p.id))) {
    await prisma.prospect.update({ where: { id: p.id }, data: { followUpAt: null, followUpNote: null } });
    scheduleCleared = true;
  }
  if (!owner) {
    if (scheduleCleared && p) await syncFollowUpPlan(user, { ...p, followUpAt: null });
    return { logged: false, scheduleCleared };
  }

  const keterangan = `Follow-up via ${channel}${p?.followUpNote ? ` — ${p.followUpNote}` : ''}`;
  const plan =
    chosen && chosen.se.trim().toLowerCase() === owner.toLowerCase()
      ? chosen
      : p
        ? await prisma.salesActivity.findFirst({ where: { prospectId: p.id, status: 'rencana', sumber: FOLLOWUP_SOURCE, se: { equals: owner, mode: 'insensitive' }, tanggal: { lte: today } } })
        : null;
  if (plan) {
    await prisma.salesActivity.update({ where: { id: plan.id }, data: { status: 'selesai', tanggal: today, keterangan } });
  } else {
    const cabang = p?.cabang ?? target.customer?.cabang ?? user.cabang ?? null;
    await prisma.salesActivity.create({
      data: {
        tanggal: today,
        se: owner,
        cabang: cabang ? cabang.toUpperCase() : null,
        reg: p?.reg ?? user.reg ?? null,
        tipe: 'telepon',
        customer,
        keterangan,
        pics: (await picsFor(customer)) as unknown as Prisma.InputJsonValue,
        prospectId: p?.id ?? null,
        status: 'selesai',
        sumber: FOLLOWUP_SOURCE,
        createdBy: user.name || user.username,
      },
    });
  }
  // A schedule that was due is fulfilled: drop any plan still left for it.
  if (scheduleCleared && p) await syncFollowUpPlan(user, { ...p, followUpAt: null });
  return { logged: true, scheduleCleared };
}
