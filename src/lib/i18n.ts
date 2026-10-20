/**
 * Terjemahan tampilan (Indonesia ↔ English).
 *
 * Kunci kamus = teks Indonesia aslinya, jadi teks yang belum diterjemahkan
 * otomatis tampil dalam Bahasa Indonesia (tidak pernah kosong). Variabel
 * ditulis {nama}: t('{n} dari {total} customer', { n, total }).
 *
 * Data (nama customer, uraian material, catatan) tidak diterjemahkan —
 * hanya label, tombol, judul, dan pesan aplikasi.
 */
import { EN } from './i18n-en';

export type Lang = 'id' | 'en';
export type TVars = Record<string, string | number | null | undefined>;
export type TFn = (text: string, vars?: TVars) => string;

export const LANG_KEY = 'tira.lang';

function fill(s: string, vars?: TVars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

/** Bahasa aktif untuk label konstanta (status, jenis aktivitas, …). Server selalu 'id'. */
let current: Lang = 'id';
export const getLang = () => current;
export const setCurrentLang = (l: Lang) => {
  current = l;
};

/**
 * Jadikan field teks sebuah objek konstanta "hidup": dibaca dalam bahasa
 * aktif (getter). Dipakai untuk STATUS_META, ACTIVITY_TYPES, dll. sehingga
 * semua tempat yang menampilkan label ikut berganti bahasa tanpa diubah satu
 * per satu.
 */
export function liveLabels<T extends object>(obj: T, keys?: string[]): T {
  const o = obj as Record<string, unknown>;
  for (const k of keys ?? Object.keys(o)) {
    const v = o[k];
    if (typeof v !== 'string') continue;
    Object.defineProperty(o, k, { get: () => translate(current, v), enumerable: true, configurable: true });
  }
  return obj;
}

export function translate(lang: Lang, text: string, vars?: TVars): string {
  if (lang === 'en') return fill(EN[text] ?? text, vars);
  return fill(text, vars);
}

/** Bahasa tersimpan di perangkat (dipakai sebelum login & di luar React). */
export function storedLang(): Lang {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'id';
  } catch {
    return 'id';
  }
}

/** Locale angka/tanggal untuk toLocaleString. */
export const localeOf = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'id-ID');
