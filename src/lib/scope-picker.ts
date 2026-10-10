import type { SafeUser } from './types';

/**
 * "Cakupan" picker: lets a user narrow a screen to part of what their role
 * already sees. The API has scoped the data (Sales: own, BM: branch, RM:
 * region, GM/Admin: all), so the choices are built from that data and only
 * at the levels below the user's own:
 *   GM/Admin -> Nasional, Regional, Cabang, SE
 *   RM       -> its Regional, Cabang in it, SE
 *   BM       -> its Cabang, SE in it
 *   Sales    -> nothing to choose (picker hidden)
 * A choice is '' (everything the role sees) or "reg:1" / "cab:SMG" / "se:BUDI".
 */

export interface ScopeRow {
  reg?: number | null;
  cabang?: string | null;
  se?: string | null;
}

export interface ScopeGroup {
  label: string;
  options: { value: string; label: string }[];
}

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

export function scopeAllLabel(user: Pick<SafeUser, 'role' | 'cabang' | 'reg' | 'se'> | null): string {
  if (!user) return 'Semua';
  if (user.role === 'rm') return `Regional ${user.reg ?? ''} (semua)`.replace('  ', ' ');
  if (user.role === 'bm') return `Cabang ${up(user.cabang)} (semua)`;
  if (user.role === 'sales') return `SE ${up(user.se)}`;
  return 'Nasional (semua)';
}

export function scopeGroups(user: Pick<SafeUser, 'role'> | null, rows: ScopeRow[]): ScopeGroup[] {
  if (!user || user.role === 'sales') return [];
  const regs = new Set<number>();
  const cabs = new Set<string>();
  const ses = new Map<string, string>(); // SE -> its cabang (first seen)
  rows.forEach((r) => {
    if (r.reg != null && Number.isFinite(Number(r.reg))) regs.add(Number(r.reg));
    const cb = up(r.cabang);
    if (cb) cabs.add(cb);
    const se = up(r.se);
    if (se && !ses.has(se)) ses.set(se, cb);
  });
  const groups: ScopeGroup[] = [];
  if (user.role === 'gm' || user.role === 'admin' || user.role === 'purchasing') {
    if (regs.size > 1) groups.push({ label: 'Regional', options: [...regs].sort((a, b) => a - b).map((r) => ({ value: `reg:${r}`, label: `Regional ${r}` })) });
  }
  if (user.role !== 'bm' && cabs.size > 1) groups.push({ label: 'Cabang', options: [...cabs].sort().map((c) => ({ value: `cab:${c}`, label: c })) });
  if (ses.size > 1)
    groups.push({
      label: 'SE',
      options: [...ses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([se, cb]) => ({ value: `se:${se}`, label: cb && user.role !== 'bm' ? `${se} · ${cb}` : se })),
    });
  return groups;
}

export function matchScope(choice: string, r: ScopeRow): boolean {
  if (!choice) return true;
  const i = choice.indexOf(':');
  const kind = choice.slice(0, i);
  const val = choice.slice(i + 1);
  if (kind === 'reg') return String(r.reg ?? '') === val;
  if (kind === 'cab') return up(r.cabang) === val;
  if (kind === 'se') return up(r.se) === val;
  return true;
}

export function scopeChoiceLabel(choice: string, user: Pick<SafeUser, 'role' | 'cabang' | 'reg' | 'se'> | null): string {
  if (!choice) return scopeAllLabel(user);
  const i = choice.indexOf(':');
  const kind = choice.slice(0, i);
  const val = choice.slice(i + 1);
  return kind === 'reg' ? `Regional ${val}` : kind === 'cab' ? `Cabang ${val}` : `SE ${val}`;
}
