import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { ACT_LABEL, BASE_ROLES, BUILTIN_ROLE_LABEL, PERM_MODULES, basePerms, clampPerms, normalizePerms, type Perms } from '@/lib/permissions';
import { invalidateRoleCache } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

const BUILTIN_BASE: Record<string, string> = { gm: 'gm', rm: 'rm', bm: 'bm', salesadmin: 'salesadmin', sales: 'sales', purchasing: 'purchasing', purchasing05: 'purchasing' };

/** Ringkasan perubahan hak untuk Log Aktivitas, mis. "Key Account: Hapus ✗, Download ✗". */
function describe(before: Perms, after: Perms): string {
  const out: string[] = [];
  PERM_MODULES.forEach((m) => {
    const ch = m.acts.filter((a) => before[m.key]?.[a] !== after[m.key]?.[a]).map((a) => `${ACT_LABEL[a]} ${after[m.key][a] ? '✓' : '✗'}`);
    if (ch.length) out.push(`${m.label}: ${ch.join(', ')}`);
  });
  return out.join('; ').slice(0, 900);
}

/**
 * Ubah role: { label?, base?, perms }. Role bawaan hanya hak-nya (label &
 * tipe dasar tetap); Admin tidak bisa diubah. Mengganti tipe dasar role
 * tambahan ikut memindahkan tipe dasar semua user yang memakainya.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { key } = await params;
  if (key === 'admin') return NextResponse.json({ error: 'Role Admin terkunci' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const raw = normalizePerms(body?.perms);
  const isBuiltin = !!BUILTIN_BASE[key];
  const existing = (await prisma.roleDef.findUnique({ where: { key } })) as { label: string; base: string; perms: unknown } | null;
  if (!isBuiltin && !existing) return NextResponse.json({ error: 'Role tidak ditemukan' }, { status: 404 });

  let label = existing?.label || BUILTIN_ROLE_LABEL[key] || key;
  let base = existing?.base || BUILTIN_BASE[key];
  if (!isBuiltin) {
    if (body?.label !== undefined) label = String(body.label || '').trim().slice(0, 60) || label;
    if (body?.base !== undefined) {
      if (!BASE_ROLES.some((b) => b.key === body.base)) return NextResponse.json({ error: 'Tipe dasar tidak dikenal' }, { status: 400 });
      base = body.base;
    }
  }
  // Disimpan sudah dipotong ke batas tipe dasar, supaya yang tersimpan = yang berlaku.
  const perms = clampPerms(raw, isBuiltin ? key : base);
  const before = existing ? clampPerms(normalizePerms(existing.perms), existing.base || base) : basePerms(isBuiltin ? key : base);
  const prevBase = existing?.base;
  const role = await prisma.roleDef.upsert({
    where: { key },
    create: { key, label, base, perms, builtin: isBuiltin, updatedBy: user.name },
    update: { label, base, perms, updatedBy: user.name },
  });
  let moved = 0;
  if (!isBuiltin && prevBase && prevBase !== base) {
    const r = await prisma.user.updateMany({ where: { customRole: key }, data: { role: base as never } });
    moved = r.count;
  }
  invalidateRoleCache();
  emitCrmEvent('roles:updated', { key });
  await logActivity({ user, action: 'update', entity: 'setting', entityId: key, summary: `Mengubah hak role "${label}"${moved ? ` (tipe dasar → ${base}, ${moved} user)` : ''}: ${describe(before, perms) || 'tanpa perubahan hak'}` });
  return NextResponse.json({ role });
}

/** Role tambahan: hapus (ditolak bila masih dipakai user). Role bawaan: kembalikan ke bawaan. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { key } = await params;
  if (key === 'admin') return NextResponse.json({ error: 'Role Admin terkunci' }, { status: 400 });
  const isBuiltin = !!BUILTIN_BASE[key];
  if (!isBuiltin) {
    const used = await prisma.user.count({ where: { customRole: key } });
    if (used) return NextResponse.json({ error: `Role masih dipakai ${used} user. Pindahkan user ke role lain dulu di Kelola User.` }, { status: 409 });
  }
  await prisma.roleDef.deleteMany({ where: { key } });
  invalidateRoleCache();
  emitCrmEvent('roles:updated', { key });
  await logActivity({ user, action: isBuiltin ? 'update' : 'delete', entity: 'setting', entityId: key, summary: isBuiltin ? `Mengembalikan hak role "${BUILTIN_ROLE_LABEL[key]}" ke bawaan` : `Menghapus role "${key}"` });
  return NextResponse.json({ ok: true });
}
