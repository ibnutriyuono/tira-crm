'use client';

import { create } from 'zustand';
import { LANG_KEY, setCurrentLang, translate, type Lang, type TFn } from '@/lib/i18n';

interface LangState {
  lang: Lang;
  hydrated: boolean;
  setLang: (l: Lang) => void;
  hydrate: () => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: 'id',
  hydrated: false,
  setLang: (lang) => {
    try {
      window.localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* perangkat tanpa storage: berlaku sampai halaman dimuat ulang */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    setCurrentLang(lang);
    set({ lang });
  },
  hydrate: () => {
    let lang: Lang = 'id';
    try {
      lang = window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'id';
    } catch {
      lang = 'id';
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    setCurrentLang(lang);
    set({ lang, hydrated: true });
  },
}));

/** t('Teks Indonesia') → teks dalam bahasa pilihan user. */
export function useT(): TFn {
  const lang = useLangStore((s) => s.lang);
  return (text, vars) => translate(lang, text, vars);
}

/** Untuk kode di luar komponen (toast, export). */
export const tNow: TFn = (text, vars) => translate(useLangStore.getState().lang, text, vars);
