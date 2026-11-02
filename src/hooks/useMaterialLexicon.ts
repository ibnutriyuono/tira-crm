'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { EMPTY_LEX, type MaterialLexicon } from '@/lib/material-learn';

/**
 * Kamus material hasil belajar (GET /api/material-lexicon), disimpan sekali
 * per halaman dan diambil ulang paling cepat tiap 5 menit — cukup untuk
 * menangkap isian baru tanpa membebani server tiap kali form dibuka.
 */
let cached: { at: number; lex: MaterialLexicon } | null = null;
let pending: Promise<MaterialLexicon> | null = null;
const FRESH = 5 * 60 * 1000;

function load(): Promise<MaterialLexicon> {
  if (cached && Date.now() - cached.at < FRESH) return Promise.resolve(cached.lex);
  if (!pending) {
    pending = api
      .get<MaterialLexicon>('/api/material-lexicon')
      .then((lex) => {
        cached = { at: Date.now(), lex };
        return lex;
      })
      .catch(() => cached?.lex || EMPTY_LEX)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Paksa ambil ulang pada pemakaian berikutnya (mis. sesudah menyimpan prospek). */
export function refreshMaterialLexicon() {
  if (cached) cached.at = 0;
}

export function useMaterialLexicon(): MaterialLexicon {
  const [lex, setLex] = useState<MaterialLexicon>(() => cached?.lex || EMPTY_LEX);
  useEffect(() => {
    let alive = true;
    void load().then((l) => alive && setLex(l));
    return () => {
      alive = false;
    };
  }, []);
  return lex;
}
