import { prisma } from './prisma';
import { notify } from './notify';
import type { SafeUser } from './types';

type P = { id: string; customer: string; cabang: string | null; se: string | null; status: number; noPo?: string | null };

/**
 * Antrian Admin Sales: prospek yang baru masuk PO/Kontrak (4) atau DO (5)
 * memberi tugas ke Admin Sales cabangnya — lengkapi No PO/lampiran, atau
 * siapkan faktur. Tidak dikirim bila Admin Sales sendiri yang memindahkannya.
 */
export async function notifyAdminTask(user: SafeUser, before: { status: number } | null, after: P): Promise<void> {
  const to = Number(after.status);
  const from = before ? Number(before.status) : -1;
  if (!(to === 4 || to === 5) || to === from || !after.cabang || user.role === 'salesadmin') return;
  try {
    const admins = await prisma.user.findMany({ where: { role: 'salesadmin', cabang: { equals: after.cabang, mode: 'insensitive' } }, select: { id: true } });
    await notify({
      userIds: admins.map((u: { id: string }) => u.id),
      type: 'admin_task',
      entity: 'prospect',
      entityId: after.id,
      title: to === 5 ? `DO baru: ${after.customer} — siapkan faktur` : `PO baru: ${after.customer} — lengkapi dokumen PO`,
      message: `${after.se ? `SE ${after.se}` : 'Sales'} memindahkan ke ${to === 5 ? 'DO' : 'PO/Kontrak'}${to === 4 && !after.noPo ? ' (No PO belum ada)' : ''}. Cek di Antrian Admin.`,
    });
  } catch (err) {
    console.error('[admin-task] gagal kirim notifikasi', err);
  }
}
