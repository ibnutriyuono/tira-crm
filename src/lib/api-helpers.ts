import { NextResponse } from 'next/server';
import { cabangRegMap, getCurrentUser } from './auth';
import type { SafeUser, Material, RfqItem } from './types';

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
  const clean = materials
    .map((m) => ({
      line: (m.line || '').trim(),
      uraian: (m.uraian || '').trim(),
      qty: num(m.qty),
      beratPc: num(m.beratPc),
      hargaKg: num(m.hargaKg),
      harga: num(m.harga),
    }))
    .filter((m) => m.uraian || m.qty || m.harga || m.beratPc || m.hargaKg);
  // Same unit-price rule as the client (see materialUnitPrice).
  const unit = (m: { beratPc: number; hargaKg: number; harga: number }) =>
    m.beratPc > 0 && m.hargaKg > 0 ? m.beratPc * m.hargaKg : m.harga;
  return {
    materials: clean,
    line: Array.from(new Set(clean.map((m) => m.line).filter(Boolean))).join(', '),
    uraian: clean.map((m) => m.uraian).filter(Boolean).join('; '),
    qty: clean.reduce((s, m) => s + m.qty, 0),
    value: clean.reduce((s, m) => s + m.qty * unit(m), 0),
  };
}

/**
 * Carries Purchasing's answer (hargaPurchasing / coo) across a Sales edit.
 *
 * Sales edits an RFQ through PUT and sends only the fields its form knows
 * about, so a naive overwrite silently erases the price Purchasing already
 * filled in. Items are matched on line+material rather than array position,
 * so inserting or reordering a material row doesn't shift the answer onto the
 * wrong item. There is deliberately no positional fallback: an item with no
 * match is new (or its material was rewritten), and inheriting a price from
 * whatever previously sat at that index would attach the wrong figure. An
 * answer present in the payload always wins.
 */
export function mergeRfqItemsPreservingAnswer(existing: RfqItem[] | null | undefined, incoming: RfqItem[]): RfqItem[] {
  const prev = Array.isArray(existing) ? existing : [];
  const keyOf = (it: RfqItem) => `${(it.line || '').trim().toLowerCase()}|${(it.material || '').trim().toLowerCase()}`;

  const byKey = new Map<string, RfqItem>();
  prev.forEach((it) => {
    const k = keyOf(it);
    if (k !== '|' && !byKey.has(k)) byKey.set(k, it);
  });

  return incoming.map((item) => {
    const match = byKey.get(keyOf(item));
    return {
      ...item,
      hargaPurchasing: item.hargaPurchasing ?? match?.hargaPurchasing,
      coo: item.coo ?? match?.coo,
    };
  });
}

/**
 * Which of a prospect's scope fields a role is allowed to choose. Sales and BM
 * are pinned to their own branch so a typo can't file a prospect into someone
 * else's cabang, where it would vanish from their own reports. RM covers several
 * branches, so only their region is fixed; GM/Admin choose freely.
 *
 * Enforced here rather than only in the form — the UI lock is a convenience,
 * this is the actual rule.
 */
export function prospectScopeLocks(user: SafeUser): { reg: boolean; cabang: boolean; se: boolean } {
  switch (user.role) {
    case 'sales': return { reg: true, cabang: true, se: true };
    case 'bm': return { reg: true, cabang: true, se: false };
    case 'rm': return { reg: true, cabang: false, se: false };
    default: return { reg: false, cabang: false, se: false };
  }
}

/**
 * Resolves the scope fields a prospect write should actually store, ignoring
 * whatever the client sent for the locked ones.
 *
 * Sales/BM accounts carry a cabang but no reg, so their region is looked up
 * from the cabang -> reg mapping in existing data. When the branch has never
 * been seen, the caller's value is kept rather than pinning it to a guess.
 */
export async function resolveProspectScope(
  user: SafeUser,
  body: { reg?: unknown; cabang?: unknown; se?: unknown } | null,
): Promise<{ reg: number | null; cabang: string; se: string }> {
  const locks = prospectScopeLocks(user);

  const cabang = (locks.cabang ? user.cabang || '' : String(body?.cabang ?? '')).trim().toUpperCase();
  const se = (locks.se ? user.se || '' : String(body?.se ?? '')).trim().toUpperCase();

  const bodyReg = body?.reg != null && body.reg !== '' ? Number(body.reg) : null;
  let reg: number | null = bodyReg;
  if (locks.reg) {
    if (user.reg != null) reg = user.reg;
    else if (cabang) reg = (await cabangRegMap())[cabang] ?? bodyReg;
  }
  return { reg: Number.isFinite(reg as number) ? (reg as number) : null, cabang, se };
}
