'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/store/useLangStore';
interface ModalProps {
  show: boolean;
  /** Kept for callers; popups now close only through their own footer button (Tutup / Batal). */
  onClose: () => void;
  title: string;
  /** Small dialog (640px) — confirmations, short forms. */
  wide?: boolean;
  /** Form size (960px) — Edit Prospek, RFQ, FUP A, surat penawaran. */
  wide2?: boolean;
  /** Large (96% of the screen, max 1600px, 92% tall) — lists, tables, dashboards. */
  xwide?: boolean;
  /** Table headers stay visible while the list scrolls (single-table list popups). */
  stickyHead?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** When provided the body+footer render inside a <form> and this fires on submit. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

const MAX_KEY = 'tira.modalMax:';
/** "Analisa Eksekutif — Nasional" and "Analisa Eksekutif — Cabang DKI" share one preference. */
const stemOf = (title: string) => title.split(' — ')[0].trim();
function readMax(stem: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MAX_KEY + stem) === '1';
  } catch {
    return false;
  }
}

/**
 * Popups close only through the Tutup / Batal button in their footer. There is
 * no × in the header, and clicking the dark backdrop or pressing Esc does
 * nothing, so a half-filled form or a long list being worked through is never
 * lost by a stray click.
 *
 * The header's ⤢ button enlarges any popup to the full screen (and back); the
 * choice is remembered per popup in this browser.
 */
export function Modal({ show, title, wide, wide2, xwide, stickyHead, children, footer, onSubmit }: ModalProps) {
  const tr = useT();
  const stem = stemOf(title);
  const [maxFor, setMaxFor] = useState<{ stem: string; on: boolean } | null>(null);
  if (show && maxFor?.stem !== stem) setMaxFor({ stem, on: readMax(stem) });
  const maximized = !!maxFor?.on && maxFor.stem === stem;

  if (!show) return null;

  const toggleMax = () => {
    const on = !maximized;
    setMaxFor({ stem, on });
    try {
      if (on) window.localStorage.setItem(MAX_KEY + stem, '1');
      else window.localStorage.removeItem(MAX_KEY + stem);
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
  };

  const body = (
    <>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </>
  );

  const cls = ['modal', wide && 'wide', wide2 && 'wide2', xwide && 'xwide', stickyHead && 'sticky-head', maximized && 'max'].filter(Boolean).join(' ');

  return (
    <div className="overlay show">
      <div className={cls}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="max-toggle" onClick={toggleMax} aria-label={maximized ? tr("Perkecil") : tr("Perbesar")} title={maximized ? tr("Perkecil") : tr("Perbesar (layar penuh)")}>
            {maximized ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            )}
          </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  );
}
