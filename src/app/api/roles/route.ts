import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { BASE_ROLES, BUILTIN_ROLE_LABEL, fullPerms, normalizePerms, roleKeyFromLabel } from '@/lib/permissions';
import { effectivePerms, invalidateRoleCache } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

const BUILTIN_BASE: Record<string, string> = { gm: 'gm', rm: 'rm', bm: 'bm', salesadmin: 'salesadmin', sales: 'sales', purchasing: 'purchasing', purchasing05: 'purchasing' };

type Row = { key: string; label: string; base: string; perms: unknown; builtin: boolean; updatedBy: string | null; updatedAt: Date };

/**
 * GET: hak user yang login ({ perms }). Admin juga menerima daftar semua
 * role (bawaan + tambahan) dengan hak dan jumlah usernya, untuk Kelola Role.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const perms = await effectivePerms(user);
  if (user.role !== 'admin') return NextResponse.json({ perms });

  const rows = (await prisma.roleDef.findMany()) as Row[];
  const users = (await prisma.user.findMany({ select: { role: true, customRole: true, name: true } })) as { role: string; customRole: string | null; name: string }[];
  const usersOf = (key: string, builtin: boolean) => users.filter((u) => (builtin ? u.role === key && !u.customRole : u.customRole === key)).map((u) => u.name);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const builtin = ['admin', ...Object.keys(BUILTIN_BASE)].map((key) => {
    const r = byKey.get(key);
    return {
      key,
      label: BUILTIN_ROLE_LABEL[key] || key,
      base: key === 'admin' ? 'gm' : BUILTIN_BASE[key],
      builtin: true,
      locked: key === 'admin',
      customized: !!r && key !== 'admin',
      perms: key === 'admin' || !r ? fullPerms() : normalizePerms(r.perms),
      users: usersOf(key, true),
      updatedBy: r?.updatedBy ?? null,
    };
  });
  const custom = rows
    .filter((r) => !r.builtin)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((r) => ({ key: r.key, label: r.label, base: r.base, builtin: false, locked: false, customized: true, perms: normalizePerms(r.perms), users: usersOf(r.key, false), updatedBy: r.updatedBy }));
  return NextResponse.json({ perms, roles: [...builtin, ...custom] });
}

/** Buat role tambahan: { label, base, perms }. Khusus Admin. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const body = await req.json().catch(() => null);
  const label = String(body?.label || '').trim().slice(0, 60);
  const base = String(body?.base || '');
  if (!label) return NextResponse.json({ error: 'Nama role wajib diisi' }, { status: 400 });
  if (!BASE_ROLES.some((b) => b.key === base)) return NextResponse.json({ error: 'Tipe dasar tidak dikenal' }, { status: 400 });
  const key = roleKeyFromLabel(label);
  if (key.length < 3 || BUILTIN_ROLE_LABEL[key]) return NextResponse.json({ error: 'Nama role tidak valid' }, { status: 400 });
  if (await prisma.roleDef.findUnique({ where: { key } })) return NextResponse.json({ error: `Role "${label}" sudah ada` }, { status: 409 });

  const role = await prisma.roleDef.create({ data: { key, label, base, perms: normalizePerms(body?.perms), builtin: false, updatedBy: user.name } });
  invalidateRoleCache();
  emitCrmEvent('roles:updated', { key });
  await logActivity({ user, action: 'create', entity: 'setting', entityId: key, summary: `Membuat role "${label}" (tipe dasar ${base})` });
  return NextResponse.json({ role }, { status: 201 });
}
