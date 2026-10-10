import { normalizeLine } from './format';

/**
 * Line 05 = barang fabrikasi. RFQ / FUP A yang berisi minimal satu item
 * Line 05 masuk ke PIC Line 05 (role `purchasing05`); PIC tersebut hanya
 * melihat dan mengerjakan dokumen seperti itu. Dokumen campuran (Line 02 +
 * Line 05) tetap juga dikerjakan Purchasing biasa.
 */
export const LINE_FABRIKASI = '05';

/** True when any item's line (a single code or "02, 05") includes `line`. Accepts "5" as "05". */
export function itemsHaveLine(items: unknown, line: string = LINE_FABRIKASI): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((it) => {
    if (!it || typeof it !== 'object') return false;
    return normalizeLine((it as { line?: unknown }).line)
      .split(/\s*,\s*/)
      .includes(line);
  });
}

/** Purchasing staff, including the PIC Line 05 (client-side twin of auth.ts#isPurchasingRole). */
export function isPurchasingRoleClient(role: string | null | undefined): boolean {
  return role === 'purchasing' || role === 'purchasing05';
}
