import { prospectScopeWhere } from './auth';
import { HASIL_LABEL, type Hasil } from './activity-contact';
import { syncFollowUpPlan } from './followup-activity';
import { logActivity } from './activity';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import type { SafeUser } from './types';

/**
 * Aktivitas Harian ↔ prospek.
 * - Aktivitas boleh ditautkan ke satu prospek (dalam cakupan user).
 * - Tanggal follow-up dari hasil kontak aktivitas yang tertaut menjadi jadwal
 *   follow-up prospek itu (Prospect.followUpAt) — dengan begitu muncul di
 *   Follow-up Board, panel prospek dan rencana Aktivitas Harian (satu baris
 *   rencana "followup", bukan dua).
 * - Aktivitas tertaut yang dilakukan pada / sesudah jadwal follow-up prospek
 *   menandai jadwal itu selesai.
 */

/** Validasi prospectId dari form: null bila kosong; error bila tidak ditemukan / di luar cakupan. */
export async function resolveActivityProspect(user: SafeUser, raw: unknown): Promise<{ id: string | null } | { error: string }> {
  const id = String(raw ?? '').trim();
  if (!id) return { id: null };
  const p = await prisma.prospect.findFirst({ where: { AND: [{ id }, prospectScopeWhere(user)] }, select: { id: true } });
  if (!p) return { error: 'Prospek terkait tidak ditemukan atau di luar cakupan Anda.' };
  return { id: p.id };
}

export async function applyActivityToProspect(
  user: SafeUser,
  act: { id: string; prospectId: string | null; tanggal: string; tipe: string; keterangan: string | null; hasil: string | null; langkah: string | null },
  followUp: string | null,
): Promise<{ followUpSet: string | null; scheduleCleared: boolean }> {
  if (!act.prospectId) return { followUpSet: null, scheduleCleared: false };
  const p = await prisma.prospect.findUnique({ where: { id: act.prospectId } });
  if (!p) return { followUpSet: null, scheduleCleared: false };

  if (followUp) {
    const note = [act.hasil ? HASIL_LABEL[act.hasil as Hasil] || act.hasil : '', act.langkah || act.keterangan || ''].filter(Boolean).join(' — ').slice(0, 300) || 'Follow-up dari Aktivitas Harian';
    const updated = await prisma.prospect.update({ where: { id: p.id }, data: { followUpAt: followUp, followUpNote: note } });
    await syncFollowUpPlan(user, updated);
    emitCrmEvent('prospect:updated', updated);
    await logActivity({ user, action: 'update', entity: 'prospect', entityId: p.id, summary: `Menjadwalkan follow-up prospek "${p.customer}" pada ${followUp} (dari Aktivitas Harian)` });
    return { followUpSet: followUp, scheduleCleared: false };
  }
  // Kontak sudah dilakukan untuk jadwal yang jatuh tempo → jadwal selesai.
  if (p.followUpAt && p.followUpAt <= act.tanggal) {
    const updated = await prisma.prospect.update({ where: { id: p.id }, data: { followUpAt: null, followUpNote: null } });
    await syncFollowUpPlan(user, updated);
    emitCrmEvent('prospect:updated', updated);
    return { followUpSet: null, scheduleCleared: true };
  }
  return { followUpSet: null, scheduleCleared: false };
}
