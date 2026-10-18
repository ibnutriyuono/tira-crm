import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { DENIED_MSG, clampPerms, fullPerms, limitReason, normalizePerms, type PermAct, type Perms } from './permissions';
import type { SafeUser } from './types';

interface RoleRow {
  key: string;
  label: string;
  base: string;
  perms: unknown;
  builtin: boolean;
}

// RoleDef jarang berubah dan dibaca di setiap request yang dijaga: simpan di
// memori, segarkan tiap 30 detik atau langsung setelah Kelola Role menyimpan.
let cache: { at: number; map: Map<string, RoleRow> } | null = null;
const TTL = 30_000;

export function invalidateRoleCache() {
  cache = null;
}

export async function roleDefs(): Promise<Map<string, RoleRow>> {
  if (cache && Date.now() - cache.at < TTL) return cache.map;
  const rows = (await prisma.roleDef.findMany()) as RoleRow[];
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r])) };
  return cache.map;
}

/**
 * Hak efektif user: Admin selalu penuh; lalu role tambahan, lalu role bawaan;
 * tanpa pengaturan = semua yang tersedia. Selalu dipotong ke batas tipe dasar
 * (user.role), jadi UI dan server memakai satu sumber yang sama.
 */
export async function effectivePerms(user: Pick<SafeUser, 'role' | 'customRole'>): Promise<Perms> {
  if (user.role === 'admin') return fullPerms();
  const defs = await roleDefs();
  const row = (user.customRole && defs.get(user.customRole)) || defs.get(user.role);
  return clampPerms(row ? normalizePerms(row.perms) : fullPerms(), user.role);
}

/**
 * Penjaga API: null bila diizinkan, atau respons 403. Untuk role Purchasing,
 * RFQ / FUP A dikerjakan lewat modul Purchasing.
 */
export async function guard(user: SafeUser, mod: string, act: PermAct): Promise<NextResponse | null> {
  if (user.role === 'admin') return null;
  const m = mod === 'rfq' && (user.role === 'purchasing' || user.role === 'purchasing05') ? 'purch' : mod;
  const perms = await effectivePerms(user);
  if (perms[m] && !perms[m][act]) return NextResponse.json({ error: limitReason(user.role, m, act) ? `${DENIED_MSG[act]} (${limitReason(user.role, m, act)})` : DENIED_MSG[act] }, { status: 403 });
  return null;
}

/**
 * Role dari form Kelola User: "sales" / "bm" / … (bawaan) atau "custom:<key>"
 * (role tambahan). Role tambahan disimpan sebagai role = tipe dasarnya dan
 * customRole = key-nya.
 */
export async function resolveRoleInput(raw: unknown, fallback: string): Promise<{ role: string; customRole: string | null } | { error: string }> {
  const v = String(raw || fallback);
  if (!v.startsWith('custom:')) return { role: v, customRole: null };
  const key = v.slice(7);
  const def = (await prisma.roleDef.findUnique({ where: { key } })) as { base: string; builtin: boolean } | null;
  if (!def || def.builtin) return { error: 'Role tidak ditemukan' };
  return { role: def.base, customRole: key };
}
