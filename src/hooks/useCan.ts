'use client';

import { can, type PermAct } from '@/lib/permissions';
import { useDataStore } from '@/store/useDataStore';

/** true bila role user yang login boleh melakukan `act` pada modul `mod` (Kelola Role). */
export function useCan(mod: string, act: PermAct = 'v'): boolean {
  return useDataStore((s) => can(s.perms, mod, act));
}

/** Versi non-hook untuk handler / fungsi biasa. */
export function canNow(mod: string, act: PermAct = 'v'): boolean {
  return can(useDataStore.getState().perms, mod, act);
}
