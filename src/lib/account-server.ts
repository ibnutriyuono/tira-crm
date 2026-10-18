import { randomInt } from 'crypto';
import { prisma } from './prisma';
import { activityOwner } from './sales-activity';

/** Username: 3–30 karakter huruf kecil, angka, titik, garis bawah, tanda hubung. */
export function usernameError(u: string): string | null {
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return 'Username 3–30 karakter: huruf kecil, angka, titik, garis bawah atau tanda hubung (tanpa spasi)';
  return null;
}

export function passwordError(p: string): string | null {
  if (p.length < 6) return 'Password minimal 6 karakter';
  if (p.length > 72) return 'Password maksimal 72 karakter';
  return null;
}

/** Password sementara yang mudah dibaca/didikte (tanpa 0/O, 1/l/I). */
export function tempPassword(): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const a = 'abcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const pick = (s: string) => s[randomInt(s.length)];
  return `${pick(A)}${pick(d)}${pick(a)}${pick(a)}-${pick(d)}${pick(A)}${pick(a)}${pick(d)}`;
}

/**
 * Ganti username di semua data yang menyimpan username (bukan id): anggota &
 * pembuat percakapan chat, penanda baca, penulis pesan dan diskusi kartu.
 * Log Aktivitas sengaja tidak diubah (jejak historis).
 */
export async function renameUsernameEverywhere(oldU: string, newU: string, userId: string) {
  // Identitas Aktivitas Harian role tanpa Kode SE memakai username (activityOwner).
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, se: true, cabang: true } });
  const oldKey = u ? activityOwner({ ...u, username: oldU }) : null;
  const newKey = u ? activityOwner({ ...u, username: newU }) : null;
  const moveActivities = oldKey && newKey && oldKey !== newKey ? [prisma.salesActivity.updateMany({ where: { se: oldKey }, data: { se: newKey } })] : [];
  await prisma.$transaction([
    ...moveActivities,
    prisma.user.update({ where: { id: userId }, data: { username: newU } }),
    prisma.$executeRaw`UPDATE "Conversation" SET "members" = array_replace("members", ${oldU}, ${newU}) WHERE ${oldU} = ANY("members")`,
    prisma.conversation.updateMany({ where: { createdBy: oldU }, data: { createdBy: newU } }),
    prisma.conversationRead.updateMany({ where: { username: oldU }, data: { username: newU } }),
    prisma.message.updateMany({ where: { authorUsername: oldU }, data: { authorUsername: newU } }),
    prisma.itemRead.updateMany({ where: { username: oldU }, data: { username: newU } }),
    prisma.itemMessage.updateMany({ where: { authorUsername: oldU }, data: { authorUsername: newU } }),
  ]);
}
