import { num } from './format';
import { flowItems } from './item-flow';
import type { Prospect } from './types';
import { useUiStore } from '@/store/useUiStore';

/**
 * After a prospect moves into PO / Kontrak or DO (kanban, QCD modal, form),
 * open "Status Item" with the qty-per-item form prefilled in full, so only
 * the items that differ need typing. Closing it without saving keeps the
 * figures as estimates (perkiraan) -- nothing is blocked. A move into Lose
 * with several items opens QCD per item (competitor per item) the same way.
 */
export function promptItemFlow(prevStatus: number | null, p: Prospect): void {
  const next = num(p.status);
  if (prevStatus === next) return;
  // Lose dengan beberapa item: tawarkan QCD & kompetitor pemenang per item
  // (terisi dari QCD prospek, jadi cukup ubah item yang berbeda).
  if (next === 6) {
    if (flowItems(p).length > 1) useUiStore.setState({ itemFlowCtx: { prospectId: p.id, mode: 'qcd' }, modal: 'itemFlow' });
    return;
  }
  if (next !== 4 && next !== 5) return;
  const items = flowItems(p);
  if (!items.length) return;
  let mode: 'po' | 'kirim' | null = null;
  if (items.some((i) => !i.poConfirmed)) mode = 'po';
  else if (next === 5 && items.some((i) => (i.po || 0) > (i.sentConfirmed ? i.sent : 0))) mode = 'kirim';
  if (!mode) return;
  useUiStore.setState({ itemFlowCtx: { prospectId: p.id, mode }, modal: 'itemFlow' });
}
