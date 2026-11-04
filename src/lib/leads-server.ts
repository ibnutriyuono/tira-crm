import { STATUS_META } from './constants';
import { leadSourceLabel } from './leads';
import { bmUserIds, notify, seUserIds } from './notify';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import type { SafeUser } from './types';

type LeadRow = { id: string; customer: string; cabang: string | null; reg: number | null; se: string | null; status: number; leadSource: string | null; leadBy: string | null; leadById: string | null; leadAt: Date | string | null; leadAssignedAt?: Date | string | null; leadQuotedAt?: Date | string | null; penawaranTerkirim?: boolean };

/**
 * Lead baru: BM cabang tujuan (bila tidak ada BM aktif: RM regionalnya) dan
 * Sales yang dipilih Marketing (bila ada) diberi tahu.
 */
export async function notifyLeadCreated(user: SafeUser, p: LeadRow): Promise<void> {
  let managers = await bmUserIds(p.cabang);
  if (!managers.length && p.reg != null) {
    managers = (await prisma.user.findMany({ where: { pausedAt: null, role: 'rm', reg: p.reg }, select: { id: true } })).map((u) => u.id);
  }
  const sales = await seUserIds(p.se);
  const src = leadSourceLabel(p.leadSource);
  await notify({
    userIds: managers,
    type: 'lead_new',
    entity: 'prospect',
    entityId: p.id,
    title: `Lead baru dari Marketing: ${p.customer}`,
    message: `${user.name} memasukkan lead${src ? ` (${src})` : ''} untuk cabang ${p.cabang || '-'}${p.se ? ` — ditugaskan ke SE ${p.se}` : ' — mohon tunjuk Sales yang menangani'}.`,
  });
  if (sales.length) {
    await notify({
      userIds: sales,
      type: 'lead_new',
      entity: 'prospect',
      entityId: p.id,
      title: `Lead untuk Anda: ${p.customer}`,
      message: `Dari ${user.name} (Marketing)${src ? ` · ${src}` : ''}. Mohon segera dihubungi.`,
    });
  }
}

/**
 * Perkembangan lead untuk Marketing pembuatnya: Sales ditunjuk, status
 * berubah (penawaran, PO/DO, lose). Sales yang baru ditunjuk juga diberi tahu.
 */
export async function notifyLeadProgress(user: SafeUser, before: LeadRow, after: LeadRow): Promise<void> {
  if (!after.leadAt && !after.leadSource) return;
  const seBefore = (before.se || '').trim().toUpperCase();
  const seAfter = (after.se || '').trim().toUpperCase();
  const changes: string[] = [];
  if (seAfter && seAfter !== seBefore) {
    changes.push(`ditugaskan ke SE ${seAfter}`);
    const sales = (await seUserIds(seAfter)).filter((id) => id !== user.id);
    if (sales.length) {
      await notify({
        userIds: sales,
        type: 'lead_new',
        entity: 'prospect',
        entityId: after.id,
        title: `Lead untuk Anda: ${after.customer}`,
        message: `${user.name} menugaskan lead dari Marketing${after.leadBy ? ` (${after.leadBy})` : ''}${after.leadSource ? ` · ${leadSourceLabel(after.leadSource)}` : ''}. Mohon segera dihubungi.`,
      });
    }
  }
  if (Number(after.status) !== Number(before.status)) changes.push(`status → ${STATUS_META[Number(after.status)]?.label || after.status}`);
  if (!changes.length || !after.leadById || after.leadById === user.id) return;
  await notify({
    userIds: [after.leadById],
    type: 'lead_update',
    entity: 'prospect',
    entityId: after.id,
    title: `Perkembangan lead: ${after.customer}`,
    message: `${after.cabang || '-'}: ${changes.join(', ')} (oleh ${user.name}).`,
  });
}

/**
 * Tonggak respons cabang atas lead (sekali saja): Sales pertama ditunjuk dan
 * penawaran pertama (status >= 2 atau penawaran ditandai terkirim). Dipakai
 * Hasil Lead (waktu respons per cabang) dan eskalasi lead.
 */
export async function stampLeadMilestones(after: LeadRow): Promise<void> {
  if (!after.leadAt && !after.leadSource) return;
  const data: { leadAssignedAt?: Date; leadQuotedAt?: Date } = {};
  if (!after.leadAssignedAt && (after.se || '').trim()) data.leadAssignedAt = new Date();
  if (!after.leadQuotedAt && (Number(after.status) >= 2 || after.penawaranTerkirim)) {
    data.leadQuotedAt = new Date();
    if (!after.leadAssignedAt && !data.leadAssignedAt) data.leadAssignedAt = data.leadQuotedAt;
  }
  if (!Object.keys(data).length) return;
  try {
    const p = await prisma.prospect.update({ where: { id: after.id }, data });
    emitCrmEvent('prospect:updated', p);
  } catch (err) {
    console.error('[leads] gagal mencap tonggak lead', after.id, err);
  }
}
