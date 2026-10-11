import { prisma } from './prisma';
import { notify } from './notify';

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const periodeLabel = (p: string) => `${BLN[Number(p.slice(5, 7)) - 1] || ''} ${p.slice(0, 4)}`.trim();

/** BM cabang: target cabang sudah ditetapkan pusat -> wajib dibagi ke Sales. */
export async function notifyBranchTargetSet(cabang: string, what: string, entityId: string): Promise<void> {
  const bms = await prisma.user.findMany({ where: { role: 'bm', cabang: { equals: cabang, mode: 'insensitive' } }, select: { id: true } });
  await notify({
    userIds: bms.map((u: { id: string }) => u.id),
    type: 'target_allocate',
    entity: 'target',
    entityId,
    title: `Target cabang ${cabang} ${what} ditetapkan`,
    message: 'Bagi target cabang ke tiap Sales di Forecast & Pipeline › Target per Sales (wajib).',
  });
}
