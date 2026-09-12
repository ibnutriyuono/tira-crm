import type { Fupa, Prospect, Rfq, SafeUser, SalesPlan } from './types';

/**
 * Client-side mirrors of the server scope rules in lib/auth.ts.
 *
 * Every list this app renders is scoped server-side on load: bootstrap runs
 * prospectScopeWhere / docScopeWhere / salesPlanScopeWhere so a Sales user is
 * handed only their own rows, a BM only their branch, an RM only their region.
 *
 * Live updates had no such guard. emitCrmEvent broadcasts to the single shared
 * 'crm' room (lib/socket.ts) — there is no per-user room — so every connected
 * browser receives every prospect, RFQ, FUP A and sales plan the moment it is
 * created or edited, anywhere in the company. The socket handlers wrote all of
 * it straight into the store, which meant the careful server-side scoping held
 * only until the next edit landed and then quietly stopped holding.
 *
 * These predicates re-apply the same rules before anything enters the store.
 *
 * They must stay in step with lib/auth.ts. Where the server writes
 * `mode: 'insensitive'` these compare case-insensitively; where it writes
 * `user.reg ?? -1` these compare against the same sentinel, so a user with no
 * region matches nothing rather than everything.
 */

/** Case-insensitive, whitespace-tolerant equality — the client-side `mode: 'insensitive'`. */
function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * The branches that belong to this user's region, derived from the prospects
 * already in the store.
 *
 * The server builds the same lookup from the prospect table (cabangRegMap) for
 * one reason: a branch has no row of its own, so its region is only knowable
 * from the prospects filed against it. On the client the store's prospects are
 * already scoped to this user, which for an RM is exactly the set of rows in
 * their own region — so the branches read off them are precisely their own.
 *
 * Same blind spot as the server's version, deliberately: a brand-new branch
 * with no prospects yet is unknown to both, so a document with a NULL reg
 * filed against it is not matched until its first prospect exists.
 */
export function myRegionCabangs(user: SafeUser, prospects: Prospect[]): Set<string> {
  const mine = new Set<string>();
  const reg = user.reg ?? -1;
  prospects.forEach((p) => {
    if (p.cabang && p.reg === reg) mine.add(p.cabang.trim().toLowerCase());
  });
  return mine;
}

/** Mirrors prospectScopeWhere(). */
export function matchesProspectScope(user: SafeUser, p: Prospect): boolean {
  switch (user.role) {
    case 'sales':
      return eq(p.se, user.se || '');
    case 'bm':
      return eq(p.cabang, user.cabang || '');
    case 'rm':
      return p.reg === (user.reg ?? -1);
    // Purchasing works the whole country's demand; gm and admin see everything.
    default:
      return true;
  }
}

/**
 * Mirrors docScopeWhere() for RFQ and FUP A.
 *
 * `requestedBy` holds a display name rather than a user id — a known
 * limitation of this schema — so, like the server, this accepts either the
 * name or the username so a renamed account keeps sight of its own documents.
 */
export function matchesDocScope(user: SafeUser, doc: Rfq | Fupa, regionCabangs?: Set<string>): boolean {
  switch (user.role) {
    case 'sales':
      return eq(doc.requestedBy, user.name) || eq(doc.requestedBy, user.username);
    case 'bm':
      return eq(doc.cabang, user.cabang || '');
    case 'rm': {
      if (doc.reg === (user.reg ?? -1)) return true;
      // Documents created without a source prospect carry a NULL reg; the
      // server falls back to matching the branch against the region's list.
      if (doc.reg != null || !doc.cabang) return false;
      return (regionCabangs ?? new Set<string>()).has(doc.cabang.trim().toLowerCase());
    }
    // gm, admin and purchasing see everything.
    default:
      return true;
  }
}

/**
 * Mirrors salesPlanScopeWhere().
 *
 * Note this is not the same rule as matchesDocScope: purchasing sees every
 * RFQ and FUP A but no sales plans at all (the server returns an
 * unsatisfiable `{ id: '__none__' }` for them).
 */
export function matchesSalesPlanScope(user: SafeUser, plan: SalesPlan, regionCabangs?: Set<string>): boolean {
  switch (user.role) {
    case 'admin':
    case 'gm':
      return true;
    case 'sales':
      return eq(plan.se, user.se || '');
    case 'bm':
      return eq(plan.cabang, user.cabang || '');
    case 'rm': {
      if (plan.reg === (user.reg ?? -1)) return true;
      if (plan.reg != null || !plan.cabang) return false;
      return (regionCabangs ?? new Set<string>()).has(plan.cabang.trim().toLowerCase());
    }
    default:
      return false;
  }
}
