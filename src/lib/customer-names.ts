/**
 * One company, one spelling. Sales type the same customer many ways
 * ("PT. Contoh Baja", "Contoh Baja, PT", "pt contoh baja"), which splits its
 * history across reports. This module decides when two spellings are the
 * same company and which spelling is the standard one ("nama baku").
 *
 * - Same company (safe to auto-correct): identical after ignoring case,
 *   punctuation, spacing and where the legal form sits ("PT X" = "X, PT"),
 *   and the legal forms don't conflict (PT X != CV X).
 * - Probably the same (suggest only): the names are a near match, e.g. a typo
 *   ("Contoh Baya") -- the user decides.
 */

const LEGAL: Record<string, string> = {
  pt: 'pt',
  cv: 'cv',
  ud: 'ud',
  tbk: 'tbk',
  persero: 'persero',
  koperasi: 'koperasi',
  kop: 'koperasi',
  pd: 'pd',
  fa: 'fa',
  ltd: 'ltd',
  inc: 'inc',
  co: 'co',
};
// Legal forms that name the KIND of company: PT X and CV X are different.
const KIND = new Set(['pt', 'cv', 'ud', 'koperasi', 'pd', 'fa']);

export interface NameParts {
  core: string;
  kind: string;
}

export function nameParts(name: string): NameParts {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[.,;:()'"`/\\-]/g, ' ')
    .replace(/&/g, ' dan ')
    .split(/\s+/)
    .filter(Boolean);
  let kind = '';
  const rest: string[] = [];
  for (const t of tokens) {
    const l = LEGAL[t];
    if (l) {
      if (KIND.has(l) && !kind) kind = l;
      continue;
    }
    rest.push(t);
  }
  return { core: rest.join(' '), kind };
}

/** Same company, safe to auto-correct one spelling to the other. */
export function sameCompany(a: string, b: string): boolean {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x.core || x.core !== y.core) return false;
  return !x.kind || !y.kind || x.kind === y.kind;
}

/** Edit distance, giving up (returns max+1) once it must exceed `max`. */
function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1, how alike two company cores are (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  const x = nameParts(a).core.replace(/\s+/g, '');
  const y = nameParts(b).core.replace(/\s+/g, '');
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Near-duplicate threshold: a typo or two in a name of normal length. */
export const SIMILAR_MIN = 0.86;

interface Prepared {
  kind: string;
  flat: string;
  digits: string;
}
const prep = (name: string): Prepared => {
  const p = nameParts(name);
  const flat = p.core.replace(/\s+/g, '');
  return { kind: p.kind, flat, digits: flat.replace(/\D/g, '') };
};
/**
 * Near-duplicate test on prepared names. Names whose numbers differ
 * ("Toko Baja 1" / "Toko Baja 2") are different customers, never typos.
 */
const similarPrepared = (x: Prepared, y: Prepared) => {
  if (x.kind && y.kind && x.kind !== y.kind) return false;
  if (x.flat.length < 5 || y.flat.length < 5 || x.digits !== y.digits) return false;
  const len = Math.max(x.flat.length, y.flat.length);
  const max = Math.floor(len * (1 - SIMILAR_MIN));
  return levenshtein(x.flat, y.flat, max) <= max;
};

export interface NameSource {
  name: string;
  /** How many records use this exact spelling. */
  count: number;
  /** Registered in Kelola Customer: that spelling is preferred as standard. */
  master?: boolean;
}

export interface NameGroup {
  key: string;
  /** Suggested standard spelling. */
  canonical: string;
  variants: { name: string; count: number; master: boolean; similarOnly: boolean }[];
  total: number;
}

const tidy = (s: string) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * The preferred spelling of a set of same-company variants: the Kelola
 * Customer name first, then the most used, then the one that states its
 * legal form up front ("PT X" over "X PT" over "X").
 */
function pickCanonical(vs: { name: string; count: number; master: boolean }[]): string {
  const score = (v: { name: string; count: number; master: boolean }) => {
    const leadingLegal = /^(pt|cv|ud)\.?\s/i.test(v.name) ? 1 : 0;
    const anyLegal = nameParts(v.name).kind ? 1 : 0;
    const caps = v.name === v.name.toLowerCase() ? 0 : 1;
    return [v.master ? 1 : 0, v.count, leadingLegal, anyLegal, caps];
  };
  return vs
    .slice()
    .sort((a, b) => {
      const x = score(a);
      const y = score(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return a.name.localeCompare(b.name);
    })[0].name;
}

/** Merge raw sources into one entry per exact spelling (trimmed). */
function collapse(sources: NameSource[]) {
  const m = new Map<string, { name: string; count: number; master: boolean }>();
  for (const s of sources) {
    const name = tidy(s.name);
    if (!name) continue;
    const e = m.get(name) || { name, count: 0, master: false };
    e.count += s.count;
    e.master = e.master || !!s.master;
    m.set(name, e);
  }
  return Array.from(m.values());
}

/**
 * Groups of spellings that are the same company. A name with no legal form
 * joins the group of its core when there is exactly one such group.
 */
function exactGroups(names: { name: string; count: number; master: boolean }[]) {
  const byKey = new Map<string, typeof names>();
  const bare: typeof names = [];
  for (const n of names) {
    const p = nameParts(n.name);
    if (!p.core) continue;
    if (!p.kind) {
      bare.push(n);
      continue;
    }
    const k = `${p.core}|${p.kind}`;
    byKey.set(k, [...(byKey.get(k) || []), n]);
  }
  const keysByCore = new Map<string, string[]>();
  byKey.forEach((_, k) => {
    const core = k.slice(0, k.lastIndexOf('|'));
    keysByCore.set(core, [...(keysByCore.get(core) || []), k]);
  });
  for (const n of bare) {
    const core = nameParts(n.name).core;
    const keys = keysByCore.get(core) || [];
    const k = keys.length === 1 ? keys[0] : `${core}|`;
    byKey.set(k, [...(byKey.get(k) || []), n]);
  }
  return byKey;
}

/**
 * Index for the customer inputs: every known spelling -> its standard
 * spelling, plus the list of standard names for the dropdown.
 */
export function buildNameIndex(sources: NameSource[]) {
  const names = collapse(sources);
  const groups = exactGroups(names);
  const canonicalOf = new Map<string, string>();
  const canonicals: string[] = [];
  groups.forEach((vs) => {
    const c = pickCanonical(vs);
    canonicals.push(c);
    vs.forEach((v) => canonicalOf.set(v.name.toLowerCase(), c));
  });
  canonicals.sort((a, b) => a.localeCompare(b));
  return { canonicalOf, canonicals, prepared: canonicals.map(prep) };
}
export type NameIndex = ReturnType<typeof buildNameIndex>;

export interface NameSuggestion {
  /** 'exact' = same company written differently (auto-correct); 'similar' = maybe a typo (ask). */
  type: 'exact' | 'similar';
  name: string;
}

/** What to tell the user about a typed name, or null when it's already standard / new. */
export function suggestName(input: string, index: NameIndex): NameSuggestion | null {
  const typed = tidy(input);
  if (!typed) return null;
  const known = index.canonicalOf.get(typed.toLowerCase());
  if (known) return known === typed ? null : { type: 'exact', name: known };
  const same = index.canonicals.find((c) => sameCompany(c, typed));
  if (same) return { type: 'exact', name: same };
  let best: { name: string; s: number } | null = null;
  const t = prep(typed);
  for (let i = 0; i < index.canonicals.length; i++) {
    const c = index.canonicals[i];
    if (!similarPrepared(index.prepared[i], t)) continue;
    const s = nameSimilarity(c, typed);
    if (!best || s > best.s) best = { name: c, s };
  }
  return best ? { type: 'similar', name: best.name } : null;
}

/**
 * Spelling groups worth unifying: same company written 2+ ways, plus names
 * that are only similar (flagged `similarOnly`, not pre-selected in the UI).
 * Biggest groups first.
 */
export function findNameGroups(sources: NameSource[]): NameGroup[] {
  const names = collapse(sources);
  const groups = Array.from(exactGroups(names).entries()).map(([key, vs]) => ({ key, vs }));
  // Union near-duplicate groups (typos) -- compare only names with the same
  // first letter and similar length to keep this fast on large lists.
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const prepared = groups.map((g) => prep(pickCanonical(g.vs)));
  // Sorted by length, each name is only compared with names a few
  // characters longer, and only when the first letter matches.
  const order = prepared.map((_, i) => i).sort((a, b) => prepared[a].flat.length - prepared[b].flat.length);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const pi = prepared[i];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      const pj = prepared[j];
      if (pj.flat.length - pi.flat.length > 3) break;
      if (pi.flat[0] !== pj.flat[0]) continue;
      if (similarPrepared(pi, pj)) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map<number, number[]>();
  groups.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) || []), i]));

  const out: NameGroup[] = [];
  clusters.forEach((idxs) => {
    const all = idxs.flatMap((i) => groups[i].vs);
    if (all.length < 2) return;
    // The standard name comes from the biggest exact group in the cluster.
    const main = idxs.slice().sort((a, b) => groups[b].vs.reduce((s, v) => s + v.count, 0) - groups[a].vs.reduce((s, v) => s + v.count, 0))[0];
    const canonical = pickCanonical(groups[main].vs);
    out.push({
      key: groups[main].key,
      canonical,
      total: all.reduce((s, v) => s + v.count, 0),
      variants: all
        .map((v) => ({ ...v, similarOnly: !sameCompany(v.name, canonical) }))
        .sort((a, b) => Number(a.similarOnly) - Number(b.similarOnly) || b.count - a.count),
    });
  });
  return out.sort((a, b) => b.total - a.total);
}
