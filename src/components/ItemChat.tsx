'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { api } from '@/lib/api-client';
import { ROLE_LABELS } from '@/lib/constants';
import { useDataStore } from '@/store/useDataStore';
import type { ItemChatMessage, ItemEntity } from '@/lib/types';

const ENTITY_LABELS: Record<ItemEntity, string> = { prospect: 'prospek', rfq: 'RFQ', fupa: 'FUP A' };

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Discussion thread attached to one prospect / RFQ / FUP A. Everyone who can
 * open the record can read and post — unlike team chat there is no membership
 * list, because the record's own scoping already decides who sees it.
 */
export function ItemChat({
  entity,
  entityId,
  onUnreadAtOpen,
}: {
  entity: ItemEntity;
  entityId: string | null;
  /**
   * How many messages were unread at the moment this thread was opened.
   * Reported from inside load() because opening the thread marks it read — read
   * the count afterwards and it is always zero.
   */
  onUnreadAtOpen?: (n: number) => void;
}) {
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const [messages, setMessages] = useState<ItemChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!entityId) return;
    try {
      // Order matters: sample the unread count before the PATCH below clears it.
      if (onUnreadAtOpen) {
        const { counts } = await api.get<{ counts: Record<string, number> }>(`/api/item-chat?entity=${entity}&counts=1`);
        onUnreadAtOpen(counts?.[entityId] || 0);
      }
      const { messages: rows } = await api.get<{ messages: ItemChatMessage[] }>(`/api/item-chat?entity=${entity}&entityId=${entityId}`);
      setMessages(rows);
      await api.patch('/api/item-chat', { entity, entityId });
    } catch {
      // an empty thread is an acceptable failure mode here
    }
    // onUnreadAtOpen is a reporting callback; re-running load on a new identity
    // would refetch the thread and re-clear the badge for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, entityId]);

  useEffect(() => {
    setMessages([]);
    load();
  }, [load]);

  // Live append for anyone else viewing the same record.
  useEffect(() => {
    if (!entityId) return;
    const s = getSocket();
    const onMessage = (m: ItemChatMessage) => {
      if (m.entity !== entity || m.entityId !== entityId) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    s.on('itemchat:message', onMessage);
    return () => {
      s.off('itemchat:message', onMessage);
    };
  }, [entity, entityId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || !entityId) return;
    setDraft('');
    try {
      const { message } = await api.post<{ message: ItemChatMessage }>('/api/item-chat', { entity, entityId, text });
      setMessages((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message]));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Pesan gagal terkirim', 'error');
    }
  }

  if (!entityId) {
    return <div className="import-summary">{`Simpan ${ENTITY_LABELS[entity]} ini terlebih dahulu untuk mulai berdiskusi.`}</div>;
  }

  return (
    <div>
      <div className="item-chat-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 12, padding: 8 }}>Belum ada diskusi pada dokumen ini.</div>
        ) : (
          messages.map((m) => {
            const mine = m.authorUsername === currentUser?.username;
            return (
              <div key={m.id} className={`tc-msg${mine ? ' mine' : ''}`}>
                <div className="tc-meta">
                  <span className="tc-meta-name">{m.author}</span>
                  {m.role ? ` · ${ROLE_LABELS[m.role] || m.role}` : ''}
                  {` · ${timeLabel(m.createdAt)}`}
                </div>
                <div className="tc-bubble">{m.text}</div>
              </div>
            );
          })
        )}
      </div>
      <div className="tc-input-row" style={{ paddingInline: 0 }}>
        <input
          type="text"
          value={draft}
          placeholder="Tulis diskusi..."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={send}>Kirim</button>
      </div>
    </div>
  );
}
