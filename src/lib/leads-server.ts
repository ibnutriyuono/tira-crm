import { cabangRegMap } from './auth';
import { cabangKey, STATUS_META } from './constants';
import { leadSourceLabel } from './leads';
import { bmUserIds, branchUserIds, notify, seUserIds } from './notify';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import type { SafeUser } from './types';

type LeadRow = { id: string; customer: string; cabang: string | null; reg: number | null; se: string | null; status: number; leadSource: string | null; leadBy: string | null; leadById: string | null; leadAt: Date | string | null; leadAssignedAt?: Date | string | null; leadQuotedAt?: Date | string | null; penawaranTerkirim?: boolean };

/** Regional lead: dari prospek, atau dari peta cabang → regional, atau dari akun BM cabangnya. */
async function leadReg(p: Pick<LeadRow, 'cabang' | 'reg'>, bm: string[]): Promise<number | null> {
  if (p.reg != null) return p.reg;
  const fromMap = (await cabangRegMap())[cabangKey(p.cabang)];
  if (fromMap != null) return fromMap;
  if (!bm.length) return null;
  const u = await prisma.user.findFirst({ where: { id: { in: bm }, reg: { not: null } }, select: { reg: true } });
  return u?.reg ?? null;
}

/**
 * Penerima lead di cabang: BM + Admin Sales cabang tujuan, dan RM regionalnya
 * (tembusan). Cabang dicocokkan dalam bentuk baku (SBY = "sby" = "Surabaya").
 */
export async function leadAudience(p: Pick<LeadRow, 'cabang' | 'reg'>): Promise<{ bm: string[]; admins: string[]; rm: string[] }> {
  const bm = await bmUserIds(p.cabang);
  const admins = await branchUserIds(p.cabang, ['salesadmin']);
  const reg = await leadReg(p, bm);
  const rm = reg != null ? (await prisma.user.findMany({ where: { pausedAt: null, role: 'rm', reg }, select: { id: true } })).map((u) => u.id) : [];
  return { bm, admins, rm };
}

export interface LeadNotified {
  bm: number;
  adminSales: number;
  rm: number;
  sales: number;
}

/**
 * Lead baru: BM + Admin Sales cabang tujuan, RM regionalnya, dan Sales yang
 * dipilih Marketing (bila ada) diberi tahu. Bila cabang itu tidak punya satu
 * pun penerima aktif, Marketing pembuatnya dan Admin diberi peringatan —
 * supaya lead tidak diam-diam tidak sampai ke siapa pun.
 */
export async function notifyLeadCreated(user: SafeUser, p: LeadRow): Promise<LeadNotified> {
  const { bm, admins, rm } = await leadAudience(p);
  const sales = await seUserIds(p.se);
  const src = leadSourceLabel(p.leadSource);
  const msg = `${user.name} memasukkan lead${src ? ` (${src})` : ''} untuk cabang ${p.cabang || '-'}${p.se ? ` — ditugaskan ke SE ${p.se}` : ' — mohon tunjuk Sales yang menangani'}.`;
  await notify({ userIds: [...bm, ...admins], type: 'lead_new', entity: 'prospect', entityId: p.id, title: `Lead baru dari Marketing: ${p.customer}`, message: msg });
  await notify({ userIds: rm.filter((id) => !bm.includes(id)), type: 'lead_new', entity: 'prospect', entityId: p.id, title: `Lead baru untuk cabang ${p.cabang || '-'}: ${p.customer}`, message: msg });
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
  if (!bm.length && !admins.length && !sales.length) {
    const adminIds = (await prisma.user.findMany({ where: { pausedAt: null, role: 'admin' }, select: { id: true } })).map((u) => u.id);
    await notify({
      userIds: [user.id, ...adminIds],
      type: 'lead_overdue',
      entity: 'prospect',
      entityId: p.id,
      title: `Lead belum sampai ke cabang ${p.cabang || '-'}: ${p.customer}`,
      message: `Tidak ada akun BM / Admin Sales aktif dengan cabang ${p.cabang || '-'}${rm.length ? ' — hanya RM yang diberi tahu' : ''}. Cek cabang akun di Kelola User, atau tunjuk Sales pada lead ini.`,
    });
  }
  return { bm: bm.length, adminSales: admins.length, rm: rm.length, sales: sales.length };
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
