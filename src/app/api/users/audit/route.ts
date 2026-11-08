import { NextResponse } from 'next/server';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

/**
 * Data audit Kelola User (Admin): pembuat akun & role-nya, kapan dibuat,
 * login terakhir, jumlah login & login gagal 30 hari, aktivitas terakhir di
 * sistem, dan jumlah prospek berjalan per kode SE. Tanpa password / hash.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const since = new Date(Date.now() - 30 * 86400000);
  const [users, logins, failed, lastAct, prospects] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true, role: true, se: true, createdAt: true, createdBy: true, createdById: true, lastLoginAt: true } }),
    prisma.activityLog.groupBy({ by: ['userId'], where: { action: 'login', createdAt: { gte: since }, userId: { not: null } }, _count: { _all: true } }),
    prisma.activityLog.groupBy({ by: ['username'], where: { action: 'login_failed', createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.activityLog.groupBy({ by: ['userId'], where: { userId: { not: null }, action: { notIn: ['login', 'logout'] } }, _max: { createdAt: true } }),
    prisma.prospect.groupBy({ by: ['se'], where: { status: { in: [1, 2, 3, 4, 5] }, se: { not: null } }, _count: { _all: true } }),
  ]);
  const roleById = new Map(users.map((u) => [u.id, u.role]));
  const loginBy = new Map(logins.map((l) => [l.userId, l._count._all]));
  const failBy = new Map(failed.map((f) => [f.username.toLowerCase(), f._count._all]));
  const actBy = new Map(lastAct.map((a) => [a.userId, a._max.createdAt]));
  const prosBy = new Map(prospects.map((p) => [String(p.se || '').trim().toUpperCase(), p._count._all]));

  return NextResponse.json({
    audit: users.map((u) => ({
      id: u.id,
      createdAt: u.createdAt,
      createdBy: u.createdBy,
      createdByRole: u.createdById ? roleById.get(u.createdById) || 'dihapus' : null,
      lastLoginAt: u.lastLoginAt,
      logins30: loginBy.get(u.id) || 0,
      failed30: failBy.get(u.username.toLowerCase()) || 0,
      lastActivityAt: actBy.get(u.id) || null,
      prospects: u.se ? prosBy.get(u.se.trim().toUpperCase()) || 0 : 0,
    })),
  });
}
