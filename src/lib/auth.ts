import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { activityOwner } from './sales-activity';
import type { SafeUser } from './types';

export const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function toSafeUser(u: { id: string; username: string; name: string; role: string; se: string | null; cabang: string | null; reg: number | null }): SafeUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role as SafeUser['role'], se: u.se, cabang: u.cabang, reg: u.reg };
}

/** Server Component / Route Handler helper: reads the session cookie via next/headers. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return toSafeUser(user);
}

/** Middleware helper: reads the session cookie straight off the NextRequest. */
export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Secure cookies are silently dropped by browsers over plain HTTP (e.g.
// serving straight off an IP:port without TLS in front) — deliberately not
// tied to NODE_ENV. Set COOKIE_SECURE=false in .env for any deployment
// that isn't behind TLS; defaults to secure (true) otherwise.
const cookieSecure = process.env.COOKIE_SECURE !== 'false';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: cookieSecure,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};

/** Mirrors the original app's per-role data scoping (getFiltered()'s role branch). */
export function prospectScopeWhere(user: SafeUser) {
  if (user.role === 'sales') return { se: { equals: user.se || '', mode: 'insensitive' as const } };
  if (user.role === 'bm') return { cabang: { equals: user.cabang || '', mode: 'insensitive' as const } };
  if (user.role === 'rm') return { reg: user.reg ?? -1 };
  // Purchasing works the whole country's demand, so it reads every prospect.
  // Listed explicitly rather than left to the fallthrough so that adding a
  // future role doesn't silently grant it access to everything.
  if (user.role === 'purchasing') return {};
  return {}; // gm & admin see everything
}

/**
 * The branches a sales account works in, read off its own prospects.
 *
 * Needed because `cabang` is not something a sales account is required to
 * have: Kelola User asks for Kode SE on a sales user and Cabang on a bm one
 * (see the guidance text in UserFormModal), and POST /api/users validates
 * neither — so a sales account created exactly as instructed stores
 * `cabang: ''`. Scoping such a user by that empty string would match no
 * branch at all and blank out their Customer list and Target Bulanan.
 *
 * Derived the same way cabangRegMap derives region -> branch: from the
 * prospect table, the only place the association is actually recorded.
 */
async function seCabangs(user: SafeUser): Promise<string[]> {
  const rows = await prisma.prospect.findMany({
    where: { se: { equals: user.se || '', mode: 'insensitive' }, cabang: { not: null } },
    select: { cabang: true },
    distinct: ['cabang'],
  });
  return rows.map((r) => r.cabang).filter((c): c is string => !!c);
}

/**
 * Customer and BudgetTarget share this exact shape: both key on `cabang`
 * only (neither has an `se` field), so sales is scoped by branch rather than
 * by SE — a customer or a branch target belongs to the branch, not to one SE
 * within it. rm resolves its own region's branches via cabangRegMap since
 * neither table carries `reg` directly.
 *
 * An account with no branch affiliation to resolve — no cabang, no se, or an
 * se with no prospects yet — matches nothing rather than everything. That is
 * the safe direction for a scope rule, but it does mean a brand-new sales
 * account sees an empty Customer list until its first prospect exists.
 */
async function cabangOnlyScopeWhere(user: SafeUser, cabangField: string) {
  if (user.role === 'bm') {
    // No branch on the account means nothing to scope to. Matching on '' would
    // otherwise quietly return any row stored with a blank cabang, which the
    // client mirror (myCabangScope) treats as no affiliation at all.
    if (!user.cabang) return { [cabangField]: { in: [] as string[], mode: 'insensitive' as const } };
    return { [cabangField]: { equals: user.cabang, mode: 'insensitive' as const } };
  }
  if (user.role === 'sales') {
    if (user.cabang) return { [cabangField]: { equals: user.cabang, mode: 'insensitive' as const } };
    if (!user.se) return { [cabangField]: { in: [] as string[], mode: 'insensitive' as const } };
    return { [cabangField]: { in: await seCabangs(user), mode: 'insensitive' as const } };
  }
  if (user.role === 'rm') {
    const map = await cabangRegMap();
    const myCabangs = Object.keys(map).filter((c) => map[c] === (user.reg ?? -1));
    return { [cabangField]: { in: myCabangs, mode: 'insensitive' as const } };
  }
  return {}; // gm, admin, purchasing see everything
}

export async function customerScopeWhere(user: SafeUser) {
  return cabangOnlyScopeWhere(user, 'cabang');
}

export async function budgetTargetScopeWhere(user: SafeUser) {
  return cabangOnlyScopeWhere(user, 'cabang');
}

/**
 * Branch -> region lookup, rebuilt from the prospect table. A branch has no
 * standalone row, so its region is only knowable from the prospects filed
 * against it — this mirrors the single-file app's cabangRegMap().
 */
export async function cabangRegMap(): Promise<Record<string, number>> {
  const rows = await prisma.prospect.findMany({
    where: { cabang: { not: null }, reg: { not: null } },
    select: { cabang: true, reg: true },
    distinct: ['cabang'],
  });
  const map: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.cabang && r.reg != null) map[r.cabang.toUpperCase()] = r.reg;
  });
  return map;
}

/**
 * Per-role scoping for the purchasing documents (RFQ, FUP A), mirroring the
 * single-file app's rfqOrFupaScopedForRole().
 *
 * sales matches on `requestedBy`, which stores the user's display name. We
 * accept either the name or the username so a renamed account doesn't lose
 * sight of its own documents.
 *
 * rm matches the denormalized `reg` OR any branch that maps into their region
 * — rows created without a source prospect have a NULL reg, and filtering on
 * that column alone silently hid them.
 */
export async function docScopeWhere(
  user: SafeUser,
  fields: { cabangField?: string; requestedByField?: string; regField?: string } = {},
) {
  const { cabangField = 'cabang', requestedByField = 'requestedBy', regField = 'reg' } = fields;

  if (user.role === 'sales') {
    return {
      OR: [
        { [requestedByField]: { equals: user.name, mode: 'insensitive' as const } },
        { [requestedByField]: { equals: user.username, mode: 'insensitive' as const } },
      ],
    };
  }
  if (user.role === 'bm') {
    return { [cabangField]: { equals: user.cabang || '', mode: 'insensitive' as const } };
  }
  if (user.role === 'rm') {
    const map = await cabangRegMap();
    const myCabangs = Object.keys(map).filter((c) => map[c] === (user.reg ?? -1));
    return {
      OR: [
        { [regField]: user.reg ?? -1 },
        { AND: [{ [regField]: null }, { [cabangField]: { in: myCabangs, mode: 'insensitive' as const } }] },
      ],
    };
  }
  return {}; // gm, admin & purchasing see everything
}

/**
 * Read scope for SalesPlan, same cabang->region hierarchy shape as
 * docScopeWhere but keyed on `se` for the sales role rather than
 * `requestedBy` — a sales plan belongs to a Sales Engineer, not to whichever
 * account happened to save it (a BM can fill one in on an SE's behalf).
 *
 * purchasing has no reason to see sales planning data, so it (and any future
 * role not listed) falls through to a filter that matches nothing rather
 * than inheriting gm/admin's open access by accident.
 */
export async function salesPlanScopeWhere(user: SafeUser) {
  if (user.role === 'admin' || user.role === 'gm') return {};
  if (user.role === 'sales') {
    return { se: { equals: user.se || '', mode: 'insensitive' as const } };
  }
  if (user.role === 'bm') {
    return { cabang: { equals: user.cabang || '', mode: 'insensitive' as const } };
  }
  if (user.role === 'rm') {
    const map = await cabangRegMap();
    const myCabangs = Object.keys(map).filter((c) => map[c] === (user.reg ?? -1));
    return {
      OR: [
        { reg: user.reg ?? -1 },
        { AND: [{ reg: null }, { cabang: { in: myCabangs, mode: 'insensitive' as const } }] },
      ],
    };
  }
  return { id: '__none__' };
}

/**
 * Who may create/edit a given SE's plan: the SE themself, their own BM (BM
 * fills plans in on behalf of the SEs in their branch, same convention as
 * ProspectFormModal's lockCabang for bm), or GM/Admin. RM is read-only here —
 * they aggregate across several branches they don't individually run.
 */
export function canEditSalesPlan(user: SafeUser, targetSe: string, targetCabang: string | null) {
  if (user.role === 'admin' || user.role === 'gm') return true;
  if (user.role === 'sales') return (user.se || '').trim().toLowerCase() === targetSe.trim().toLowerCase();
  if (user.role === 'bm') return (user.cabang || '').trim().toLowerCase() === (targetCabang || '').trim().toLowerCase();
  return false;
}

/**
 * Deleting a prospect is restricted to GM and Admin — Sales and BM can edit
 * their own rows but not remove pipeline history. Mirrors the single-file
 * app's canDeleteProspect().
 */
export function canDeleteProspect(user: SafeUser) {
  return user.role === 'gm' || user.role === 'admin';
}

/** Write-side permission for the purchasing module (vendors, quotations, status moves). */
export function canEditPurchasing(user: SafeUser) {
  return user.role === 'purchasing' || user.role === 'admin';
}

/** Who may fill in the purchasing answer on an RFQ / FUP A. */
export function canEditRfqAnswer(user: SafeUser) {
  return canEditPurchasing(user) || user.role === 'gm';
}

/**
 * Who may set a branch's sales target. rm is limited to branches in their own
 * region, resolved through the prospect data (a branch has no standalone row).
 */
export async function canEditBudgetTarget(user: SafeUser, cabang: string): Promise<boolean> {
  const target = (cabang || '').toUpperCase();
  if (user.role === 'admin' || user.role === 'gm') return true;
  if (user.role === 'rm') {
    // Resolved here rather than taken as an optional argument: the previous
    // signature defaulted to "allowed" when the caller omitted the map, which
    // let any RM edit any branch's target.
    const map = await cabangRegMap();
    return map[target] === (user.reg ?? -1);
  }
  if (user.role === 'bm') return (user.cabang || '').toUpperCase() === target;
  return false;
}

/**
 * Read scope for SalesActivity / ActivityTarget. Both carry the same se /
 * cabang / reg columns as SalesPlan, so the hierarchy is identical: sales sees
 * their own SE, bm their branch, rm their region, gm/admin everything, and
 * every other role (purchasing) nothing.
 */
export const salesActivityScopeWhere = salesPlanScopeWhere;

/**
 * Sales accounts (with a Kode SE) and branch managers (BM, who also hold their
 * own customers) log activities, always under their own identity (see
 * activityOwner). RM / GM / admin read and set targets but do not log on
 * anyone's behalf -- an entry typed in for an SE would count toward that SE's
 * KPI without the SE having done it.
 */
export function canWriteSalesActivity(user: SafeUser): boolean {
  return activityOwner(user) !== null;
}

/**
 * Perjalanan dinas: GM/admin see every trip; an RM sees their own plus the
 * trips of BMs in their region and any trip into a branch of their region;
 * a BM sees their own plus trips into their branch (e.g. the RM visiting).
 * Sales/purchasing see none.
 */
export function visitTripScopeWhere(user: SafeUser) {
  if (user.role === 'admin' || user.role === 'gm') return {};
  if (user.role === 'rm') {
    const reg = user.reg ?? -1;
    return { OR: [{ ownerId: user.id }, { ownerReg: reg }, { reg }] };
  }
  if (user.role === 'bm') {
    return { OR: [{ ownerId: user.id }, { cabang: { equals: user.cabang || '__none__', mode: 'insensitive' as const } }] };
  }
  return { id: '__none__' };
}
