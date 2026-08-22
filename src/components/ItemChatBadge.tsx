'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { api } from '@/lib/api-client';
import type { ItemEntity } from '@/lib/types';

/**
 * Unread-discussion badge for a row. Counts for the whole entity type are
 * fetched in one request by the parent list (see useItemChatCounts) rather
 * than one call per row.
 */
export function useItemChatCounts(entity: ItemEntity, enabled: boolean) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      api
        .get<{ counts: Record<string, number> }>(`/api/item-chat?entity=${entity}&counts=1`)
        .then((d) => !cancelled && setCounts(d.counts || {}))
        .catch(() => {});
    load();

    const s = getSocket();
    const onMessage = (m: { entity: string }) => {
      if (m.entity === entity) load();
    };
    s.on('itemchat:message', onMessage);
    return () => {
      cancelled = true;
      s.off('itemchat:message', onMessage);
    };
  }, [entity, enabled]);

  return counts;
}

export function ItemChatBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="item-chat-bubble" title={`${count} diskusi baru`}>
      {count > 9 ? '9+' : count}
    </span>
  );
}
