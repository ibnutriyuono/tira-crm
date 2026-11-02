'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/api-client';
import { DEFAULT_SEGMENTS, normalizeTaxonomy, type SegmentDef } from '@/lib/customer-segments';

/**
 * Daftar segmen & sub-segmen customer (GET /api/customer-segments), satu
 * salinan per halaman. setSegmentsLocal dipakai Kelola Segmen sesudah Admin
 * menyimpan, supaya semua form langsung memakai daftar baru.
 */
type State = { segments: SegmentDef[]; canEdit: boolean; loaded: boolean };
let state: State = { segments: normalizeTaxonomy(DEFAULT_SEGMENTS), canEdit: false, loaded: false };
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setSegmentsLocal(segments: SegmentDef[]) {
  state = { ...state, segments };
  emit();
}

function load() {
  if (state.loaded || loading) return;
  loading = true;
  api
    .get<{ segments: SegmentDef[]; canEdit: boolean }>('/api/customer-segments')
    .then((r) => {
      state = { segments: r.segments, canEdit: r.canEdit, loaded: true };
      emit();
    })
    .catch(() => {})
    .finally(() => {
      loading = false;
    });
}

export function useSegments(): State {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
  useEffect(load, []);
  return s;
}
