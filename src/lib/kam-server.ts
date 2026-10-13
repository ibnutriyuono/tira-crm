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
    const groups = (await prisma.customerGroup.findMany()) as unknown as CustomerGroup[];
    return groupForCustomer(buildGroupIndex(groups), customer);
  } catch {
    return null;
  }
}

/**
 * Customer milik sebuah grup (tier apa pun) diproses dari cabang selain home
 * cabang grup — atau, bila home cabang belum diisi, dari cabang mana pun:
 * beri tahu ketua grup, yang menentukan harga & term untuk grup itu.
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
    if (!g || !g.ketuaId || g.ketuaId === input.user.id) return;
    const cab = (input.cabang || '').trim().toUpperCase();
    if (!cab || (g.homeCabang && cab === g.homeCabang.toUpperCase())) return;
    await notify({
      userIds: [g.ketuaId],
      type: 'kam_cross_branch',
      entity: input.entity,
      entityId: input.entityId,
      title: `${isKeyTier(g.tier) ? `${g.tier === 'strategic' ? 'Strategic' : 'Key'} Account` : 'Grup'} ${g.name}: ${input.what} dari ${cab}`,
      message: `${input.user.name} (${cab}) membuat ${input.what} untuk ${input.customer}. Sebagai ketua grup, cek harga & term sebelum dikirim ke customer.`,
    });
  } catch (err) {
    console.error('[kam] gagal mengirim notifikasi lintas cabang', err);
  }
}
