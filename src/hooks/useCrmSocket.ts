'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { BudgetTarget, SalesPlan, Customer, Fupa, ItemChatMessage, Prospect, PurchasingContact, Rfq, SafeUser, Vendor, AppNotification } from '@/lib/types';

/**
 * Notification toasts open the document they are about. Purchasing works from
 * the standalone /purchasing page (no modals mounted), everyone else from the
 * monitor modal — setting both covers each without knowing which is rendered.
 */
export function openPurchDoc(jenis: 'RFQ' | 'FUPA', id: string) {
  useUiStore.setState({ purchDetailCtx: { jenis, id } });
  if (useDataStore.getState().currentUser?.role !== 'purchasing') useUiStore.getState().openModal('purchasing');
}

/** Sales owns a document by name: `requestedBy` is free text, not a user id. */
function isOwnedByCurrentUser(requestedBy: string | null): boolean {
  const me = useDataStore.getState().currentUser;
  return !!me && !!requestedBy && requestedBy.trim() === me.name.trim();
}

/**
 * Subscribes the shared data store to server-pushed change events so every
 * connected user's screen updates live when someone else edits data —
 * replaces the original single-file app's "everyone reads the same
 * window.storage key" model with real push updates.
 */
export function useCrmSocket() {
  useEffect(() => {
    const s = getSocket();
    const store = useDataStore.getState();

    const onProspectUpsert = (p: Prospect) => useDataStore.getState().upsertProspect(p);
    const onProspectDelete = ({ id }: { id: string }) => useDataStore.getState().removeProspect(id);
    const onProspectBulk = () => useDataStore.getState().refetchProspects();

    const onCustomerUpsert = (c: Customer) => useDataStore.getState().upsertCustomer(c);
    const onCustomerDelete = ({ id }: { id: string }) => useDataStore.getState().removeCustomer(id);
    const onCustomerBulk = () => useDataStore.getState().refetchCustomers();

    // Compare against the copy already in the store to spot the transitions
    // worth announcing; the update itself happens either way.
    const onRfqUpsert = (r: Rfq) => {
      const prev = useDataStore.getState().rfqs.find((x) => x.id === r.id);
      useDataStore.getState().upsertRfq(r);
      if (!prev || !isOwnedByCurrentUser(r.requestedBy)) return;
      const noDoc = r.noRfq || '(tanpa nomor)';
      if (!prev.jawabanRfqDikirim && r.jawabanRfqDikirim) {
        useDataStore.getState().toast(`Purchasing menjawab RFQ ${noDoc}`, 'success', () => openPurchDoc('RFQ', r.id));
      } else if (prev.status !== 'Selesai' && r.status === 'Selesai') {
        useDataStore.getState().toast(`RFQ ${noDoc} ditandai Selesai`, 'success', () => openPurchDoc('RFQ', r.id));
      }
    };
    const onRfqDelete = ({ id }: { id: string }) => useDataStore.getState().removeRfq(id);

    const onFupaUpsert = (f: Fupa) => {
      const prev = useDataStore.getState().fupas.find((x) => x.id === f.id);
      useDataStore.getState().upsertFupa(f);
      if (!prev || !isOwnedByCurrentUser(f.requestedBy)) return;
      const noDoc = f.noFupa || '(tanpa nomor)';
      if (!prev.jawabanFupaDikirim && f.jawabanFupaDikirim) {
        useDataStore.getState().toast(`Purchasing menjawab FUP A ${noDoc}`, 'success', () => openPurchDoc('FUPA', f.id));
      } else if (prev.status !== 'Selesai' && f.status === 'Selesai') {
        useDataStore.getState().toast(`FUP A ${noDoc} ditandai Selesai`, 'success', () => openPurchDoc('FUPA', f.id));
      }
    };
    const onFupaDelete = ({ id }: { id: string }) => useDataStore.getState().removeFupa(id);

    // --- notifications -----------------------------------------------------
    // Only Purchasing is toasted about arrivals: admin/gm see every document
    // company-wide, which would be noise for a module they check rather than
    // live in. They still get the TopBar badge.
    const onRfqCreated = (r: Rfq) => {
      useDataStore.getState().upsertRfq(r);
      if (useDataStore.getState().currentUser?.role !== 'purchasing') return;
      useDataStore.getState().toast(
        `RFQ baru masuk: ${r.noRfq || '(tanpa nomor)'} dari ${r.cabang || '-'} — ${r.customer || '-'}`,
        'info',
        () => openPurchDoc('RFQ', r.id),
      );
    };
    const onFupaCreated = (f: Fupa) => {
      useDataStore.getState().upsertFupa(f);
      if (useDataStore.getState().currentUser?.role !== 'purchasing') return;
      useDataStore.getState().toast(
        `FUP A baru masuk: ${f.noFupa || '(tanpa nomor)'} dari ${f.cabang || '-'} — ${f.customer || '-'}`,
        'info',
        () => openPurchDoc('FUPA', f.id),
      );
    };

    // Discussion on a document: Purchasing hears about all of them, the
    // requesting Sales user only about their own — never about their own message.
    const onItemChatMessage = (m: ItemChatMessage) => {
      const me = useDataStore.getState().currentUser;
      if (!me || m.authorUsername === me.username) return;
      // ItemEntity also covers 'prospect' threads, which are not Purchasing's.
      if (m.entity !== 'rfq' && m.entity !== 'fupa') return;
      const jenis: 'RFQ' | 'FUPA' = m.entity === 'rfq' ? 'RFQ' : 'FUPA';
      const parent =
        jenis === 'RFQ'
          ? useDataStore.getState().rfqs.find((r) => r.id === m.entityId)
          : useDataStore.getState().fupas.find((f) => f.id === m.entityId);
      if (!parent) return;
      if (me.role !== 'purchasing' && !isOwnedByCurrentUser(parent.requestedBy)) return;
      const noDoc = (jenis === 'RFQ' ? (parent as Rfq).noRfq : (parent as Fupa).noFupa) || '(tanpa nomor)';
      const text = m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text;
      useDataStore.getState().toast(
        `Pesan baru di ${jenis === 'RFQ' ? 'RFQ' : 'FUP A'} ${noDoc} — ${m.author}: ${text}`,
        'info',
        () => openPurchDoc(jenis, m.entityId),
      );
    };


    const onBudgetUpsert = (b: BudgetTarget) => useDataStore.getState().upsertBudgetTarget(b);
    const onSalesPlanUpsert = (p: SalesPlan) => useDataStore.getState().upsertSalesPlan(p);

    // Notifications are already targeted to one specific user at creation
    // time (see lib/notify.ts — one row per recipient), but emitCrmEvent
    // broadcasts to the single shared 'crm' room regardless, so every
    // connected client receives every notification event. The exact userId
    // match here is what actually keeps someone else's notification off
    // your screen.
    const onNotificationNew = (n: AppNotification) => {
      const me = useDataStore.getState().currentUser;
      if (!me || n.userId !== me.id) return;
      useDataStore.getState().upsertNotification(n);
    };

    const onVendorUpsert = (v: Vendor) => useDataStore.getState().upsertVendor(v);
    const onVendorDelete = ({ id }: { id: string }) => useDataStore.getState().removeVendor(id);
    const onVendorBulk = () => useDataStore.getState().refetchVendors();

    const onUserUpsert = (u: SafeUser) => useDataStore.getState().upsertUser(u);
    const onUserDelete = ({ id }: { id: string }) => useDataStore.getState().removeUser(id);

    const onPurchasingContact = (c: PurchasingContact) => useDataStore.getState().setPurchasingContact(c);
    const onDatabaseRestored = () => {
      useDataStore.getState().toast('Database dipulihkan oleh admin. Memuat ulang data...', 'info');
      store.bootstrap();
    };

    s.on('prospect:created', onProspectUpsert);
    s.on('prospect:updated', onProspectUpsert);
    s.on('prospect:deleted', onProspectDelete);
    s.on('prospect:bulk-imported', onProspectBulk);

    s.on('customer:created', onCustomerUpsert);
    s.on('customer:updated', onCustomerUpsert);
    s.on('customer:deleted', onCustomerDelete);
    s.on('customer:bulk-imported', onCustomerBulk);

    s.on('rfq:created', onRfqCreated);
    s.on('rfq:updated', onRfqUpsert);
    s.on('rfq:deleted', onRfqDelete);

    s.on('fupa:created', onFupaCreated);
    s.on('fupa:updated', onFupaUpsert);
    s.on('fupa:deleted', onFupaDelete);

    s.on('itemchat:message', onItemChatMessage);

    s.on('budget:updated', onBudgetUpsert);
    s.on('salesPlan:updated', onSalesPlanUpsert);
    s.on('notification:new', onNotificationNew);

    s.on('vendor:created', onVendorUpsert);
    s.on('vendor:updated', onVendorUpsert);
    s.on('vendor:deleted', onVendorDelete);
    s.on('vendor:bulk-imported', onVendorBulk);

    s.on('user:created', onUserUpsert);
    s.on('user:updated', onUserUpsert);
    s.on('user:deleted', onUserDelete);

    s.on('purchasingContact:updated', onPurchasingContact);
    s.on('database:restored', onDatabaseRestored);

    return () => {
      s.off('prospect:created', onProspectUpsert);
      s.off('prospect:updated', onProspectUpsert);
      s.off('prospect:deleted', onProspectDelete);
      s.off('prospect:bulk-imported', onProspectBulk);
      s.off('customer:created', onCustomerUpsert);
      s.off('customer:updated', onCustomerUpsert);
      s.off('customer:deleted', onCustomerDelete);
      s.off('customer:bulk-imported', onCustomerBulk);
      s.off('fupa:created', onFupaCreated);
      s.off('fupa:updated', onFupaUpsert);
      s.off('fupa:deleted', onFupaDelete);
      s.off('budget:updated', onBudgetUpsert);
      s.off('salesPlan:updated', onSalesPlanUpsert);
      s.off('notification:new', onNotificationNew);
      s.off('vendor:created', onVendorUpsert);
      s.off('vendor:updated', onVendorUpsert);
      s.off('vendor:deleted', onVendorDelete);
      s.off('vendor:bulk-imported', onVendorBulk);
      s.off('rfq:created', onRfqCreated);
      s.off('rfq:updated', onRfqUpsert);
      s.off('rfq:deleted', onRfqDelete);
      s.off('user:created', onUserUpsert);
      s.off('user:updated', onUserUpsert);
      s.off('user:deleted', onUserDelete);
      s.off('itemchat:message', onItemChatMessage);
      s.off('purchasingContact:updated', onPurchasingContact);
      s.off('database:restored', onDatabaseRestored);
    };
  }, []);
}
