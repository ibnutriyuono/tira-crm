'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconBag, IconCalendar, IconChat, IconCheck, IconRfq, IconTrash } from '../icons';
import { api } from '@/lib/api-client';
import { openPurchDoc } from '@/hooks/useCrmSocket';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { AppNotification, NotificationType } from '@/lib/types';

const NOTIF_META: Record<NotificationType, { icon: () => React.JSX.Element; color: string }> = {
  rfq_new: { icon: IconRfq, color: 'steel' },
  fupa_new: { icon: IconBag, color: 'steel' },
  rfq_answered: { icon: IconCheck, color: 'green' },
  fupa_answered: { icon: IconCheck, color: 'green' },
  rfq_done: { icon: IconCheck, color: 'green' },
  fupa_done: { icon: IconCheck, color: 'green' },
  rfq_chat: { icon: IconChat, color: 'amber' },
  fupa_chat: { icon: IconChat, color: 'amber' },
  rfq_cancelled: { icon: IconTrash, color: 'rust' },
  fupa_cancelled: { icon: IconTrash, color: 'rust' },
  trip_submitted: { icon: IconCalendar, color: 'amber' },
  trip_approved: { icon: IconCheck, color: 'green' },
  trip_rejected: { icon: IconTrash, color: 'rust' },
  trip_scheduled: { icon: IconCalendar, color: 'steel' },
  trip_cancelled: { icon: IconTrash, color: 'rust' },
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * The persistent counterpart to the toasts fired in useCrmSocket.ts — those
 * disappear after a few seconds and only reach someone who's online at that
 * exact moment. Every notification row created server-side (see
 * lib/notify.ts) lands here too, so it's still findable later. Clicking a
 * row reuses openPurchDoc, the exact same navigation the toasts already use,
 * so both paths always land on the same screen.
 */
export function NotificationsModal() {
  const show = useUiStore((s) => s.modal === 'notifications');
  const closeModal = useUiStore((s) => s.closeModal);
  const toast = useDataStore((s) => s.toast);

  const notifications = useDataStore((s) => s.notifications);
  const markNotificationRead = useDataStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useDataStore((s) => s.markAllNotificationsRead);

  const [filter, setFilter] = useState<'semua' | 'belum'>('semua');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => (filter === 'belum' ? notifications.filter((n) => !n.readAt) : notifications), [notifications, filter]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  function onRowClick(n: AppNotification) {
    if (!n.readAt) {
      markNotificationRead(n.id);
      api.patch(`/api/notifications/${n.id}`, {}).catch(() => {});
    }
    closeModal();
    if (n.entity === 'visitTrip') {
      useUiStore.setState({ visitTripOpenId: n.entityId });
      useUiStore.getState().openModal('visitTrip');
      return;
    }
    // openPurchDoc already branches per role: purchasing goes straight to
    // their dedicated page's inline detail, everyone else gets the
    // Purchasing modal opened for them — same helper the toast onClick
    // handlers use, so this must not duplicate that logic here.
    openPurchDoc(n.entity === 'rfq' ? 'RFQ' : 'FUPA', n.entityId);
  }

  async function onMarkAllRead() {
    if (unreadCount === 0) return;
    setBusy(true);
    markAllNotificationsRead();
    try {
      await api.patch('/api/notifications', { markAllRead: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menandai semua dibaca', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Notifikasi"
      wide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      <div className="toolbar-row" style={{ marginBottom: 10 }}>
        <div className="view-toggle">
          <button type="button" className={filter === 'semua' ? 'active' : ''} onClick={() => setFilter('semua')}>
            Semua
          </button>
          <button type="button" className={filter === 'belum' ? 'active' : ''} onClick={() => setFilter('belum')}>
            Belum Dibaca {unreadCount > 0 && `(${unreadCount})`}
          </button>
        </div>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || unreadCount === 0} onClick={onMarkAllRead} style={{ marginLeft: 'auto' }}>
          Tandai Semua Dibaca
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <h3>{filter === 'belum' ? 'Tidak ada notifikasi belum dibaca' : 'Belum ada notifikasi'}</h3>
          <p>Notifikasi RFQ/FUP A baru, jawaban Purchasing, diskusi, pembatalan, dan Perjalanan Dinas akan muncul di sini.</p>
        </div>
      ) : (
        <div className="notif-list">
          {list.map((n) => {
            const meta = NOTIF_META[n.type];
            const Icon = meta?.icon ?? IconRfq;
            const unread = !n.readAt;
            return (
              <div key={n.id} className={`notif-row${unread ? ' unread' : ''}`} onClick={() => onRowClick(n)}>
                <span className={`notif-icon ${meta?.color ?? 'steel'}`}>
                  <Icon />
                </span>
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-message">{n.message}</div>
                  <div className="notif-time">{timeAgo(n.createdAt)}</div>
                </div>
                {unread && <span className="notif-dot" title="Belum dibaca" />}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
