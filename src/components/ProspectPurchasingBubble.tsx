'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';

interface ChatCounts {
  counts: Record<string, number>;
  reads: Record<string, string>;
}

/**
 * Rolls up everything notification-worthy on the RFQ/FUP A documents belonging
 * to each prospect, so Sales sees it on the prospect card/row itself instead of
 * having to open Kelola RFQ / Kelola FUP A to discover something changed.
 *
 * Per linked document it counts unread discussion messages and a Purchasing
 * answer that landed since this user last opened that document. Both use the
 * same server-side read cursor the per-document badges use, so opening the
 * document clears both at once — and it follows the user across devices, which
 * a localStorage cursor would not.
 *
 * Fetched once for all prospects (two requests, not two per row) and refreshed
 * on the same socket events that would change the answer.
 */
export function useProspectPurchasingCounts(enabled: boolean): Record<string, number> {
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const [rfqChat, setRfqChat] = useState<ChatCounts>({ counts: {}, reads: {} });
  const [fupaChat, setFupaChat] = useState<ChatCounts>({ counts: {}, reads: {} });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      api.get<ChatCounts>('/api/item-chat?entity=rfq&counts=1').then((d) => !cancelled && setRfqChat({ counts: d.counts || {}, reads: d.reads || {} })).catch(() => {});
      api.get<ChatCounts>('/api/item-chat?entity=fupa&counts=1').then((d) => !cancelled && setFupaChat({ counts: d.counts || {}, reads: d.reads || {} })).catch(() => {});
    };
    load();

    const s = getSocket();
    const onChanged = () => load();
    s.on('itemchat:message', onChanged);
    s.on('rfq:updated', onChanged);
    s.on('fupa:updated', onChanged);
    return () => {
      cancelled = true;
      s.off('itemchat:message', onChanged);
      s.off('rfq:updated', onChanged);
      s.off('fupa:updated', onChanged);
    };
  }, [enabled]);

  const byProspect: Record<string, number> = {};
  if (!enabled) return byProspect;

  const add = (prospectId: string | null, n: number) => {
    if (!prospectId || n <= 0) return;
    byProspect[prospectId] = (byProspect[prospectId] || 0) + n;
  };

  rfqs.forEach((r) => {
    add(r.prospectId, rfqChat.counts[r.id] || 0);
    const seen = rfqChat.reads[r.id];
    if (r.jawabanRfqDikirim && r.jawabanRfqAt && (!seen || r.jawabanRfqAt > seen)) add(r.prospectId, 1);
  });
  fupas.forEach((f) => {
    add(f.prospectId, fupaChat.counts[f.id] || 0);
    const seen = fupaChat.reads[f.id];
    if (f.jawabanFupaDikirim && f.jawabanFupaAt && (!seen || f.jawabanFupaAt > seen)) add(f.prospectId, 1);
  });

  return byProspect;
}

/** Steel, to stay distinguishable from the red per-document discussion bubble. */
export function ProspectPurchasingBubble({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="item-chat-bubble purch" title={`${count} kabar baru dari RFQ / FUP A`}>
      {count > 9 ? '9+' : count}
    </span>
  );
}
