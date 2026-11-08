import { ROLE_LABELS } from './constants';
import { bmUserIds, notify, seUserIds } from './notify';
import { prisma } from './prisma';
import type { SafeUser } from './types';

/**
 * FUP A dikirim ke Purchasing oleh selain Sales-nya (Admin, Admin Sales, BM,
 * dst.): BM cabang dan Sales yang bersangkutan diberi tahu. Sales = SE prospek
 * terkait; bila tidak ada, akun yang namanya sama dengan "Diminta oleh".
 * Pengirim sendiri tidak ikut diberi tahu.
 */
export async function notifyFupaSubmitted(
  user: SafeUser,
  fupa: { id: string; noFupa: string | null; cabang: string | null; customer: string | null; requestedBy: string | null; prospectId: string | null; items: unknown },
): Promise<void> {
  if (user.role === 'sales') return;
  const prospect = fupa.prospectId ? await prisma.prospect.findUnique({ where: { id: fupa.prospectId }, select: { se: true } }) : null;
  let sales = await seUserIds(prospect?.se);
  if (!sales.length && fupa.requestedBy) {
    sales = (await prisma.user.findMany({ where: { pausedAt: null, role: 'sales', name: { equals: fupa.requestedBy.trim(), mode: 'insensitive' } }, select: { id: true } })).map((u) => u.id);
  }
  const bm = await bmUserIds(fupa.cabang);
  const to = Array.from(new Set([...bm, ...sales])).filter((id) => id !== user.id);
  if (!to.length) return;
  const n = Array.isArray(fupa.items) ? fupa.items.length : 0;
  await notify({
    userIds: to,
    type: 'fupa_submitted',
    entity: 'fupa',
    entityId: fupa.id,
    title: `FUP A ${fupa.noFupa || '(tanpa nomor)'} dikirim ke Purchasing`,
    message: `${user.name} (${ROLE_LABELS[user.role] || user.role}) mengirim FUP A untuk ${fupa.customer || '-'}${fupa.cabang ? ` · ${fupa.cabang}` : ''}${n ? ` — ${n} item` : ''}${prospect?.se ? ` · SE ${prospect.se}` : ''}.`,
  });
}
