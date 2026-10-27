'use client';

import { useSyncExternalStore } from 'react';

/**
 * Mode HP (web responsif): otomatis di layar ≤ 760px. User bisa memaksa
 * tampilan desktop / HP (disimpan di browser ini saja).
 */
const KEY = 'tira.viewMode';
const QUERY = '(max-width: 760px)';
const listeners = new Set<() => void>();

function readPref(): 'auto' | 'hp' | 'desktop' {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'hp' || v === 'desktop' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function snapshot(): boolean {
  if (typeof window === 'undefined') return false;
  const pref = readPref();
  if (pref !== 'auto') return pref === 'hp';
  return window.matchMedia(QUERY).matches;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', cb);
  };
}

export function setPhonePref(v: 'auto' | 'hp' | 'desktop') {
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* tanpa localStorage: hanya untuk sesi ini */
  }
  listeners.forEach((l) => l());
}

export function usePhoneMode(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Layar memang kecil (untuk menawarkan "kembali ke tampilan HP"). */
export function isSmallScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
}
