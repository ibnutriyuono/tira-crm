import { NextResponse } from 'next/server';
import { getCurrentUser } from './auth';
import type { SafeUser, Material } from './types';

export async function requireUser(): Promise<SafeUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sesi tidak valid. Silakan login kembali.' }, { status: 401 });
  return user;
}

export function requireAdmin(user: SafeUser): NextResponse | null {
  if (user.role !== 'admin') return NextResponse.json({ error: 'Hanya admin yang dapat melakukan aksi ini.' }, { status: 403 });
  return null;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Derives the flattened legacy fields (line/uraian/qty/value) from a materials array — mirrors the original form submit handler. */
export function deriveFromMaterials(materials: Material[]) {
  const clean = materials.map((m) => ({ line: (m.line || '').trim(), uraian: (m.uraian || '').trim(), qty: num(m.qty), harga: num(m.harga) })).filter((m) => m.uraian || m.qty || m.harga);
  return {
    materials: clean,
    line: Array.from(new Set(clean.map((m) => m.line).filter(Boolean))).join(', '),
    uraian: clean.map((m) => m.uraian).filter(Boolean).join('; '),
    qty: clean.reduce((s, m) => s + m.qty, 0),
    value: clean.reduce((s, m) => s + m.qty * m.harga, 0),
  };
}
