'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChat } from './icons';
import { getSocket } from '@/lib/socket-client';
import { api } from '@/lib/api-client';
import { BROADCAST_ROLE_OPTIONS, ROLE_LABELS } from '@/lib/constants';
import { useDataStore } from '@/store/useDataStore';
import type { ChatConversation, ChatMessage, RosterUser, SafeUser } from '@/lib/types';

type Picker = 'dm' | 'group' | 'broadcast' | null;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Stable colour per author, so the same person keeps the same name colour
// across sessions. Steel is reserved for the current user.
const AUTHOR_COLORS = ['#B3721F', '#963B27', '#256B49', '#4B5560', '#7A2E8E', '#1F6F8B'];
function authorColor(username: string) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

function timeLabel(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
}

/**
 * Floating team-chat widget: DM / group / broadcast, laid out to match the
 * single-file mockup. Messages arrive over the CRM's existing Socket.IO
 * connection rather than the prototype's 8-second poll.
 */
export function TeamChatWidget() {
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [open, setOpen] = useState(false);
  const [convs, setConvs] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // --- picker form state ---
  const [userSearch, setUserSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [broadcastRole, setBroadcastRole] = useState('sales');
  const [broadcastText, setBroadcastText] = useState('');

  const loadConvs = useCallback(async () => {
    try {
      const { conversations } = await api.get<{ conversations: ChatConversation[] }>('/api/conversations');
      setConvs(conversations);
    } catch {
      // an empty widget beats a nagging toast
    }
  }, []);

  const loadRoster = useCallback(async () => {
    if (roster.length > 0) return;
    try {
      const { roster: rows } = await api.get<{ roster: RosterUser[] }>('/api/users/roster');
      setRoster(rows);
    } catch {
      toast('Gagal memuat daftar anggota', 'error');
    }
  }, [roster.length, toast]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const { messages: rows } = await api.get<{ messages: ChatMessage[] }>(`/api/conversations/${id}/messages`);
      setMessages(rows);
      await api.post(`/api/conversations/${id}/read`);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat percakapan', 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    loadConvs();
    // The roster resolves DM titles to real names — load it immediately rather
    // than waiting for a picker to open, or threads read as raw usernames.
    loadRoster();
  }, [currentUser, loadConvs, loadRoster]);

  useEffect(() => {
    if (currentUser?.role) setBroadcastRole(currentUser.role);
  }, [currentUser?.role]);

  // Live delivery: append into the open thread, otherwise bump the badge.
  useEffect(() => {
    if (!currentUser) return;
    const s = getSocket();
    const onMessage = (m: ChatMessage & { members?: string[] }) => {
      if (m.members && !m.members.includes(currentUser.username)) return;
      if (m.conversationId === activeId) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.authorUsername !== currentUser.username) api.post(`/api/conversations/${m.conversationId}/read`).catch(() => {});
      } else {
        setConvs((prev) =>
          prev.map((c) =>
            c.id === m.conversationId
              ? { ...c, unread: (c.unread || 0) + 1, lastMessage: { text: m.text, author: m.author, createdAt: m.createdAt } }
              : c,
          ),
        );
      }
    };
    const onConversation = () => loadConvs();

    // Keep the directory live. loadRoster() only fetches once (and only when
    // the widget mounts), so without this a user added or renamed through
    // Kelola User stays invisible in the pickers — and unresolved in DM
    // titles — for every session that was already open.
    const onUserUpsert = (u: SafeUser) => {
      const row: RosterUser = { id: u.id, username: u.username, name: u.name, role: u.role, cabang: u.cabang };
      setRoster((prev) => {
        const next = prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [...prev, row];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
    };
    const onUserDelete = ({ id }: { id: string }) => setRoster((prev) => prev.filter((u) => u.id !== id));

    s.on('chat:message', onMessage);
    s.on('chat:conversation', onConversation);
    s.on('user:created', onUserUpsert);
    s.on('user:updated', onUserUpsert);
    s.on('user:deleted', onUserDelete);
    return () => {
      s.off('chat:message', onMessage);
      s.off('chat:conversation', onConversation);
      s.off('user:created', onUserUpsert);
      s.off('user:updated', onUserUpsert);
      s.off('user:deleted', onUserDelete);
    };
  }, [currentUser, activeId, loadConvs]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const others = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return roster.filter(
      (u) =>
        u.username !== currentUser?.username &&
        (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
    );
  }, [roster, userSearch, currentUser?.username]);

  function openPicker(kind: Exclude<Picker, null>) {
    setUserSearch('');
    if (kind === 'group') {
      setGroupName('');
      setGroupMembers([]);
    }
    if (kind === 'broadcast') setBroadcastText('');
    loadRoster();
    setPicker(kind);
  }

  async function startDm(username: string) {
    setBusy(true);
    try {
      const { conversation } = await api.post<{ conversation: ChatConversation }>('/api/conversations', { type: 'dm', members: [username] });
      setPicker(null);
      await loadConvs();
      openThread(conversation.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memulai percakapan', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    const name = groupName.trim();
    if (!name) return toast('Isi nama grup terlebih dahulu.', 'error');
    if (groupMembers.length === 0) return toast('Pilih minimal satu anggota.', 'error');
    setBusy(true);
    try {
      const { conversation } = await api.post<{ conversation: ChatConversation }>('/api/conversations', { type: 'group', name, members: groupMembers });
      setPicker(null);
      await loadConvs();
      toast(`Grup "${name}" berhasil dibuat`, 'success');
      openThread(conversation.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat grup', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendBroadcast() {
    const text = broadcastText.trim();
    if (!text) return toast('Isi pesan broadcast terlebih dahulu.', 'error');
    setBusy(true);
    try {
      // Ensure the per-role channel exists, then post into it.
      const { conversation } = await api.post<{ conversation: ChatConversation }>('/api/conversations', { type: 'broadcast', targetRole: broadcastRole });
      await api.post(`/api/conversations/${conversation.id}/messages`, { text });
      setPicker(null);
      await loadConvs();
      toast(`Broadcast terkirim ke role ${ROLE_LABELS[broadcastRole] || broadcastRole}`, 'success');
      openThread(conversation.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim broadcast', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !activeId) return;
    setDraft('');
    try {
      const { message } = await api.post<{ message: ChatMessage }>(`/api/conversations/${activeId}/messages`, { text });
      setMessages((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message]));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Pesan gagal terkirim', 'error');
    }
  }

  if (!currentUser) return null;

  const totalUnread = convs.reduce((s, c) => s + (c.unread || 0), 0);
  const active = convs.find((c) => c.id === activeId) || null;

  const displayName = (c: ChatConversation) => {
    if (c.type === 'broadcast') return `📢 ${ROLE_LABELS[c.name || ''] || c.name || 'Broadcast'}`;
    if (c.type === 'group') return c.name || 'Grup';
    const other = c.members.find((m) => m !== currentUser.username) || '';
    return roster.find((u) => u.username === other)?.name || other || 'Percakapan';
  };
  const subLabel = (c: ChatConversation) =>
    c.type === 'broadcast' ? 'Kanal broadcast' : c.type === 'group' ? `${c.members.length} anggota` : 'Percakapan langsung';

  return (
    <>
      <button type="button" className="chat-fab" onClick={() => setOpen((v) => !v)} title="Chat">
        <IconChat />
        {totalUnread > 0 && <span className="chat-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
      </button>

      {open && (
        <div className="tc-panel">
          <div className="tc-head">
            {activeId && (
              <button type="button" className="tc-back" onClick={() => setActiveId(null)} aria-label="Kembali">←</button>
            )}
            <div className="tc-title-wrap">
              <div className="tc-title">{active ? displayName(active) : 'Chat'}</div>
              <div className="tc-sub">{active ? subLabel(active) : 'Steel Division'}</div>
            </div>
            <button type="button" className="tc-close" onClick={() => setOpen(false)} aria-label="Tutup">×</button>
          </div>

          {!activeId ? (
            <div className="tc-list-pane">
              <div className="tc-list-actions">
                <button type="button" onClick={() => openPicker('dm')}>+ Chat</button>
                <button type="button" onClick={() => openPicker('group')}>+ Grup</button>
                <button type="button" onClick={() => openPicker('broadcast')}>+ Broadcast</button>
              </div>
              <div className="tc-conv-list">
                {convs.length === 0 ? (
                  <div className="tc-empty">Belum ada percakapan. Mulai dengan tombol di atas.</div>
                ) : (
                  convs.map((c) => (
                    <button key={c.id} type="button" className="tc-conv-row" onClick={() => openThread(c.id)}>
                      <div className={`tc-conv-avatar ${c.type}`}>
                        {c.type === 'broadcast' ? '📢' : c.type === 'group' ? '#' : initials(displayName(c))}
                      </div>
                      <div className="tc-conv-main">
                        <div className="tc-conv-name">{displayName(c)}</div>
                        <div className="tc-conv-preview">
                          {c.lastMessage ? `${c.lastMessage.author}: ${c.lastMessage.text}` : 'Belum ada pesan'}
                        </div>
                      </div>
                      <div className="tc-conv-meta">
                        <span className="tc-conv-time">{timeLabel(c.lastMessage?.createdAt || c.updatedAt)}</span>
                        {c.unread > 0 && <span className="tc-conv-unread">{c.unread}</span>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="tc-thread-pane">
              <div className="tc-body" ref={bodyRef}>
                {messages.length === 0 ? (
                  <div className="tc-empty">Belum ada pesan.</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.authorUsername === currentUser.username;
                    return (
                      <div key={m.id} className={`tc-msg${mine ? ' mine' : ''}`}>
                        <div className="tc-meta">
                          <span
                            className="tc-meta-name"
                            style={mine ? undefined : { color: authorColor(m.authorUsername) }}
                          >
                            {m.author}
                          </span>
                          {m.role ? ` · ${ROLE_LABELS[m.role] || m.role}` : ''}
                          {` · ${timeLabel(m.createdAt)}`}
                        </div>
                        <div className="tc-bubble">{m.text}</div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="tc-input-row">
                <input
                  type="text"
                  value={draft}
                  placeholder="Tulis pesan..."
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
          )}
        </div>
      )}

      {picker && (
        <div className="tc-overlay" onClick={() => setPicker(null)}>
          <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
            {picker === 'dm' && (
              <>
                <div className="tc-modal-head">
                  <h3>Mulai Chat Baru</h3>
                  <button type="button" className="close-x" onClick={() => setPicker(null)}>×</button>
                </div>
                <div className="tc-picker-search">
                  <input type="search" placeholder="Cari nama anggota..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                </div>
                <div className="tc-user-scroll">
                  {others.length === 0 ? (
                    <div className="tc-empty">Tidak ada anggota ditemukan.</div>
                  ) : (
                    others.map((u) => (
                      <button key={u.id} type="button" className="tc-user-row" disabled={busy} onClick={() => startDm(u.username)}>
                        <div className="tc-conv-avatar dm">{initials(u.name)}</div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <div className="tc-user-name">{u.name}</div>
                          <div className="tc-user-role">{ROLE_LABELS[u.role] || u.role}{u.cabang ? ` · ${u.cabang}` : ''}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="tc-modal-foot">
                  <button type="button" className="btn btn-outline" onClick={() => setPicker(null)}>Tutup</button>
                </div>
              </>
            )}

            {picker === 'group' && (
              <>
                <div className="tc-modal-head">
                  <h3>Buat Grup Baru</h3>
                  <button type="button" className="close-x" onClick={() => setPicker(null)}>×</button>
                </div>
                <div className="tc-modal-body">
                  <label className="tc-field-label">Nama Grup</label>
                  <input type="text" placeholder="cth. Tim Regional 2" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                  <label className="tc-field-label" style={{ marginTop: 12 }}>Pilih Anggota</label>
                  <input type="search" placeholder="Cari nama anggota..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                  <div className="tc-user-scroll bordered">
                    {others.length === 0 ? (
                      <div className="tc-empty">Tidak ada anggota ditemukan.</div>
                    ) : (
                      others.map((u) => (
                        <label key={u.id} className="tc-user-row">
                          <input
                            type="checkbox"
                            checked={groupMembers.includes(u.username)}
                            onChange={(e) =>
                              setGroupMembers((prev) => (e.target.checked ? [...prev, u.username] : prev.filter((m) => m !== u.username)))
                            }
                          />
                          <div style={{ flex: 1 }}>
                            <div className="tc-user-name">{u.name}</div>
                            <div className="tc-user-role">{ROLE_LABELS[u.role] || u.role}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="tc-modal-foot">
                  <button type="button" className="btn btn-outline" onClick={() => setPicker(null)}>Batal</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={createGroup}>Buat Grup</button>
                </div>
              </>
            )}

            {picker === 'broadcast' && (
              <>
                <div className="tc-modal-head">
                  <h3>Broadcast Pesan</h3>
                  <button type="button" className="close-x" onClick={() => setPicker(null)}>×</button>
                </div>
                <div className="tc-modal-body">
                  <div className="import-summary" style={{ marginTop: 0, marginBottom: 14 }}>
                    Pesan akan dikirim ke <b>semua anggota dengan role terpilih</b> sebagai kanal broadcast tersendiri. Anda juga otomatis menjadi anggota kanal ini.
                  </div>
                  <label className="tc-field-label">Kirim ke Role</label>
                  <select value={broadcastRole} onChange={(e) => setBroadcastRole(e.target.value)}>
                    {BROADCAST_ROLE_OPTIONS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                  <label className="tc-field-label" style={{ marginTop: 12 }}>Pesan</label>
                  <textarea placeholder="Tulis pengumuman..." value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} />
                </div>
                <div className="tc-modal-foot">
                  <button type="button" className="btn btn-outline" onClick={() => setPicker(null)}>Batal</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={sendBroadcast}>Kirim Broadcast</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
