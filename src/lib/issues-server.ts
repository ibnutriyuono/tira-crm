import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import { notify } from './notify';
import { isBranchRole } from './roles';
import { ESKALASI_ATAS_HARI, ESKALASI_BM_HARI, HASIL_META, issueCatLabel, type PipelineIssue } from './issues';
import type { SafeUser } from './types';

type ProspectLite = { id: string; se: string | null; cabang: string | null; reg: number | null; customer: string; status: number };

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** Masalah yang boleh dilihat user: cakupan prospeknya, ditambah semua masalah yang menjadikannya PJ. */
export function issueScopeWhere(user: SafeUser): Record<string, unknown> {
  const mine = { pjIds: { array_contains: [user.id] } };
  if (user.role === 'sales') return { OR: [{ se: { equals: user.se || '__none__', mode: 'insensitive' } }, mine] };
  if (isBranchRole(user.role)) return { OR: [{ cabang: { equals: user.cabang || '__none__', mode: 'insensitive' } }, mine] };
  if (user.role === 'rm') return { OR: [{ reg: user.reg ?? -1 }, mine] };
  if (user.role === 'purchasing05') return mine;
  return {}; // gm, admin, purchasing
}

/** BM cabang prospek (atau Admin) membuat laporan resmi / menerima usulan. */
export function canReport(user: SafeUser, p: { cabang: string | null }): boolean {
  if (user.role === 'admin') return true;
  return user.role === 'bm' && !!user.cabang && up(user.cabang) === up(p.cabang);
}

/** Sales pemilik prospek mengajukan masalah ke BM. */
export function canPropose(user: SafeUser, p: { se: string | null }): boolean {
  return user.role === 'sales' && !!user.se && up(user.se) === up(p.se);
}

/** PJ, BM cabangnya, atau Admin menangani & menutup masalah. */
export function canHandle(user: SafeUser, i: Pick<PipelineIssue, 'pjIds' | 'cabang'>): boolean {
  return (Array.isArray(i.pjIds) && i.pjIds.includes(user.id)) || canReport(user, { cabang: i.cabang });
}

export function cleanPjIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  return Array.from(new Set(list.map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean))).slice(0, 10);
}

export async function existingUserIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const ok = new Set(rows.map((r: { id: string }) => r.id));
  return ids.filter((id) => ok.has(id));
}

export async function userNames(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const m = new Map<string, string>(rows.map((r: { id: string; name: string }) => [r.id, r.name] as [string, string]));
  return ids.map((id) => m.get(id) || '(user dihapus)');
}

async function ids(where: Record<string, unknown>): Promise<string[]> {
  const rows = await prisma.user.findMany({ where, select: { id: true } });
  return rows.map((r: { id: string }) => r.id);
}
export const salesOf = (se: string | null) => (se ? ids({ se: { equals: se, mode: 'insensitive' } }) : Promise.resolve([] as string[]));
export const bmsOf = (cabang: string | null) => (cabang ? ids({ role: 'bm', cabang: { equals: cabang, mode: 'insensitive' } }) : Promise.resolve([] as string[]));

/** Catatan otomatis di thread Diskusi kartu prospek (thread yang sama dengan Purchasing). */
export async function postSystemMessage(prospectId: string, text: string): Promise<void> {
  try {
    const message = await prisma.itemMessage.create({
      data: { entity: 'prospect', entityId: prospectId, author: 'Sistem', authorUsername: 'system', role: 'system', text: text.slice(0, 1000) },
    });
    emitCrmEvent('itemchat:message', message);
  } catch (err) {
    console.error('[issue] gagal menulis catatan diskusi', err);
  }
}

export async function notifyIssue(i: PipelineIssue, userIds: string[], actor: SafeUser | null, type: 'issue_proposed' | 'issue_new' | 'issue_update' | 'issue_escalated', title: string, message: string): Promise<void> {
  const list = userIds.filter((u) => !actor || u !== actor.id);
  await notify({ userIds: list, type, entity: 'issue', entityId: i.id, title, message: message.slice(0, 300) });
}

export function issueSnapshot(p: ProspectLite) {
  return { prospectId: p.id, se: p.se, cabang: p.cabang, reg: p.reg, customer: p.customer };
}

export const pjText = async (pjIds: string[]) => (await userNames(pjIds)).join(', ') || '-';
export const closeText = (solusi: string, hasil: string) => `✓ Selesai — ${solusi} · ${HASIL_META[hasil as keyof typeof HASIL_META] || hasil}`;

/**
 * Prospek di-Lose (status 6) dengan masalah aktif: masalah ikut ditutup
 * (hasil Lose); usulan yang belum diproses BM ditolak otomatis.
 */
export async function closeIssuesOnLose(p: ProspectLite, user: SafeUser): Promise<void> {
  if (Number(p.status) !== 6) return;
  try {
    const rows = (await prisma.prospectIssue.findMany({ where: { prospectId: p.id, status: { in: ['usulan', 'open', 'proses'] } } })) as unknown as PipelineIssue[];
    for (const i of rows) {
      const data =
        i.status === 'usulan'
          ? { status: 'ditolak', alasanTolak: 'Prospek Lose Order / Batal' }
          : { status: 'selesai', hasil: 'lose', solusi: i.solusi || 'Prospek Lose Order / Batal', selesaiAt: new Date(), selesaiNama: user.name };
      const fresh = (await prisma.prospectIssue.update({ where: { id: i.id }, data })) as unknown as PipelineIssue;
      emitCrmEvent('issue:updated', fresh);
      await postSystemMessage(p.id, i.status === 'usulan' ? '⚑ Usulan masalah ditutup — prospek Lose Order / Batal' : `✓ Masalah ditutup otomatis — prospek Lose Order / Batal (${issueCatLabel(i.kategori)})`);
      await notifyIssue(fresh, [...(i.pjIds || []), ...(await bmsOf(i.cabang))], user, 'issue_update', `Masalah ditutup (Lose): ${i.customer}`, `${issueCatLabel(i.kategori)} — prospek di-Lose oleh ${user.name}.`);
    }
  } catch (err) {
    console.error('[issue] gagal menutup masalah prospek lose', err);
  }
}

let lastSweep = 0;
/**
 * Eskalasi: laporan belum ditangani > 2 hari -> BM cabangnya; belum selesai
 * > 4 hari -> RM regionalnya + GM. Sekali per tingkat. Dipanggil saat CRM /
 * Notifikasi dibuka (tanpa penjadwal).
 */
export async function sweepIssueEscalation(opts: { force?: boolean; now?: Date } = {}): Promise<void> {
  if (!opts.force && Date.now() - lastSweep < 5 * 60 * 1000) return;
  lastSweep = Date.now();
  try {
    const now = opts.now || new Date();
    const age = (d: string | Date | null) => (d ? (now.getTime() - new Date(d).getTime()) / 86400000 : 0);
    const rows = (await prisma.prospectIssue.findMany({ where: { status: { in: ['open', 'proses'] }, eskalasi: { lt: 2 } } })) as unknown as PipelineIssue[];
    for (const i of rows) {
      const a = age(i.dilaporAt || i.createdAt);
      if (a > ESKALASI_ATAS_HARI) {
        const to = [...(i.reg != null ? await ids({ role: 'rm', reg: i.reg }) : []), ...(await ids({ role: 'gm' }))];
        const fresh = (await prisma.prospectIssue.update({ where: { id: i.id }, data: { eskalasi: 2 } })) as unknown as PipelineIssue;
        emitCrmEvent('issue:updated', fresh);
        await notifyIssue(fresh, to, null, 'issue_escalated', `Eskalasi: masalah ${i.customer} belum selesai ${Math.floor(a)} hari`, `${issueCatLabel(i.kategori)} · ${i.cabang || '-'} · PJ: ${await pjText(i.pjIds)}`);
        await postSystemMessage(i.prospectId, `↑ Dieskalasi ke RM & GM — belum selesai lebih dari ${ESKALASI_ATAS_HARI} hari`);
      } else if (i.status === 'open' && i.eskalasi < 1 && a > ESKALASI_BM_HARI) {
        const fresh = (await prisma.prospectIssue.update({ where: { id: i.id }, data: { eskalasi: 1 } })) as unknown as PipelineIssue;
        emitCrmEvent('issue:updated', fresh);
        await notifyIssue(fresh, await bmsOf(i.cabang), null, 'issue_escalated', `Eskalasi: masalah ${i.customer} belum ditangani ${Math.floor(a)} hari`, `${issueCatLabel(i.kategori)} · PJ: ${await pjText(i.pjIds)} belum menangani.`);
        await postSystemMessage(i.prospectId, `↑ Dieskalasi ke BM — belum ditangani lebih dari ${ESKALASI_BM_HARI} hari`);
      }
    }
  } catch (err) {
    console.error('[issue] gagal eskalasi', err);
  }
}
