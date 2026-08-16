'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import type { Customer, Prospect, PurchasingContact, Rfq, SafeUser } from '@/lib/types';

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

    const onRfqUpsert = (r: Rfq) => useDataStore.getState().upsertRfq(r);
    const onRfqDelete = ({ id }: { id: string }) => useDataStore.getState().removeRfq(id);

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

    s.on('rfq:created', onRfqUpsert);
    s.on('rfq:updated', onRfqUpsert);
    s.on('rfq:deleted', onRfqDelete);

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
      s.off('rfq:created', onRfqUpsert);
      s.off('rfq:updated', onRfqUpsert);
      s.off('rfq:deleted', onRfqDelete);
      s.off('user:created', onUserUpsert);
      s.off('user:updated', onUserUpsert);
      s.off('user:deleted', onUserDelete);
      s.off('purchasingContact:updated', onPurchasingContact);
      s.off('database:restored', onDatabaseRestored);
    };
  }, []);
}
