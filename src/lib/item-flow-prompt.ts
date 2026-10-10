import { num } from './format';
import { flowItems } from './item-flow';
import type { Prospect } from './types';
import { useUiStore } from '@/store/useUiStore';

/**
 * After a prospect moves into PO / Kontrak or DO (kanban, QCD modal, form),
 * open "Status Item" with the qty-per-item form prefilled in full, so only
 * the items that differ need typing. Closing it without saving keeps the
 * figures as estimates (perkiraan) -- nothing is blocked.
 */
export function promptItemFlow(prevStatus: number | null, p: Prospect): void {
  const next = num(p.status);
  if ((next !== 4 && next !== 5) || prevStatus === next) return;
  const items = flowItems(p);
  if (!items.length) return;
  let mode: 'po' | 'kirim' | null = null;
  if (items.some((i) => !i.poConfirmed)) mode = 'po';
  else if (next === 5 && items.some((i) => (i.po || 0) > (i.sentConfirmed ? i.sent : 0))) mode = 'kirim';
  if (!mode) return;
  useUiStore.setState({ itemFlowCtx: { prospectId: p.id, mode }, modal: 'itemFlow' });
}
