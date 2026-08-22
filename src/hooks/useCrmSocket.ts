'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import type { BudgetTarget, Customer, Fupa, Prospect, PurchasingContact, Rfq, SafeUser, Vendor } from '@/lib/types';

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

    const onFupaUpsert = (f: Fupa) => useDataStore.getState().upsertFupa(f);
    const onFupaDelete = ({ id }: { id: string }) => useDataStore.getState().removeFupa(id);

    const onBudgetUpsert = (b: BudgetTarget) => useDataStore.getState().upsertBudgetTarget(b);

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

    s.on('rfq:created', onRfqUpsert);
    s.on('rfq:updated', onRfqUpsert);
    s.on('rfq:deleted', onRfqDelete);

    s.on('fupa:created', onFupaUpsert);
    s.on('fupa:updated', onFupaUpsert);
    s.on('fupa:deleted', onFupaDelete);

    s.on('budget:updated', onBudgetUpsert);

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
      s.off('fupa:created', onFupaUpsert);
      s.off('fupa:updated', onFupaUpsert);
      s.off('fupa:deleted', onFupaDelete);
      s.off('budget:updated', onBudgetUpsert);
      s.off('vendor:created', onVendorUpsert);
      s.off('vendor:updated', onVendorUpsert);
      s.off('vendor:deleted', onVendorDelete);
      s.off('vendor:bulk-imported', onVendorBulk);
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
