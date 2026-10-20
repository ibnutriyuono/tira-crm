'use client';

import { useEffect } from 'react';
import { useLangStore } from '@/store/useLangStore';

import { useT } from '@/store/useLangStore';
/** Memuat bahasa tersimpan saat aplikasi dibuka (dipasang sekali di layout). */
export function LangSync() {
  useEffect(() => {
    useLangStore.getState().hydrate();
  }, []);
  return null;
}

/** Tombol ID | EN. `dark` untuk bilah atas berwarna gelap. */
export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const tr = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  return (
    <div className={`lang-switch${dark ? ' dark' : ''}`} role="group" aria-label="Bahasa / Language">
      {(['id', 'en'] as const).map((l) => (
        <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)} title={l === 'id' ? tr("Bahasa Indonesia") : tr("English")}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
