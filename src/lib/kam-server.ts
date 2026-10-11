import { prisma } from './prisma';
import { buildGroupIndex, groupForCustomer, isKeyTier } from './kam';
import { notify } from './notify';
import type { CustomerGroup, SafeUser } from './types';

/**
 * Server helpers for Key Account Management. Best-effort: a failed lookup or
 * notification never fails the save that triggered it.
 */
export async function groupOfCustomer(customer: string): Promise<CustomerGroup | null> {
  try {
    const groups = (await prisma.customerGroup.findMany({ where: { tier: { in: ['strategic', 'key'] } } })) as unknown as CustomerGroup[];
    return groupForCustomer(buildGroupIndex(groups), customer);
  } catch {
    return null;
  }
}

/**
 * A Strategic / Key account handled from a branch other than its home branch:
 * tell the team lead (ketua tim), who sets price & terms for the group.
 */
export async function notifyKamCrossBranch(input: {
  user: SafeUser;
  customer: string;
  cabang: string | null | undefined;
  entity: 'prospect' | 'rfq';
  entityId: string;
  what: string;
}): Promise<void> {
  try {
    const g = await groupOfCustomer(input.customer);
    if (!g || !isKeyTier(g.tier) || !g.ketuaId || g.ketuaId === input.user.id) return;
    const cab = (input.cabang || '').trim().toUpperCase();
    if (!cab || !g.homeCabang || cab === g.homeCabang.toUpperCase()) return;
    await notify({
      userIds: [g.ketuaId],
      type: 'kam_cross_branch',
      entity: input.entity,
      entityId: input.entityId,
      title: `${g.tier === 'strategic' ? 'Strategic' : 'Key'} Account ${g.name}: ${input.what} dari ${cab}`,
      message: `${input.user.name} (${cab}) membuat ${input.what} untuk ${input.customer}. Sebagai ketua tim, cek harga & term sebelum dikirim ke customer.`,
    });
  } catch (err) {
    console.error('[kam] gagal mengirim notifikasi lintas cabang', err);
  }
}
