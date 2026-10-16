'use client';

import { can, type PermAct, type Perms } from '@/lib/permissions';
import { useDataStore } from '@/store/useDataStore';

/**
 * Sama dengan penjaga API (permissions-server `guard`): Admin selalu boleh,
 * dan bagi Purchasing / PIC Line 05 modul RFQ / FUP A dibaca sebagai modul
 * Purchasing — supaya tombol yang tampil = aksi yang diizinkan server.
 */
function check(perms: Perms | null, role: string | undefined, mod: string, act: PermAct): boolean {
  if (role === 'admin') return true;
  const m = mod === 'rfq' && (role === 'purchasing' || role === 'purchasing05') ? 'purch' : mod;
  return can(perms, m, act);
}

/** true bila role user yang login boleh melakukan `act` pada modul `mod` (Kelola Role). */
export function useCan(mod: string, act: PermAct = 'v'): boolean {
  return useDataStore((s) => check(s.perms, s.currentUser?.role, mod, act));
}

/** Versi non-hook untuk handler / fungsi biasa. */
export function canNow(mod: string, act: PermAct = 'v'): boolean {
  const s = useDataStore.getState();
  return check(s.perms, s.currentUser?.role, mod, act);
}
