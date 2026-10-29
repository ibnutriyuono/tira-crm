'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tampilan desktop baru (navigasi kiri, Beranda, panel prospek) vs tampilan
 * lama (bar atas). Default: baru. Pilihan disimpan di browser ini saja,
 * supaya selama masa transisi user bisa kembali ke tampilan lama.
 */
const KEY = 'tira.deskUi';
const listeners = new Set<() => void>();
let mem: boolean | null = null;

function read(): boolean {
  if (mem != null) return mem;
  try {
    return localStorage.getItem(KEY) !== 'lama';
  } catch {
    return true;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setDeskPref(v: 'baru' | 'lama') {
  mem = v === 'baru';
  try {
    if (v === 'baru') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'lama');
  } catch {
    /* tanpa localStorage: hanya untuk sesi ini */
  }
  listeners.forEach((l) => l());
}

export function useDeskMode(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
