import { create } from 'zustand';
import type { Customer, Prospect, PurchasingContact, Rfq, SafeUser } from '@/lib/types';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface DataState {
  currentUser: SafeUser | null;
  prospects: Prospect[];
  customers: Customer[];
  rfqs: Rfq[];
  users: SafeUser[]; // only populated for admins when Kelola User modal opens
  purchasingContact: PurchasingContact;
  loaded: boolean;
  toasts: Toast[];

  bootstrap: () => Promise<void>;
  setCurrentUser: (u: SafeUser | null) => void;

  upsertProspect: (p: Prospect) => void;
  removeProspect: (id: string) => void;
  upsertCustomer: (c: Customer) => void;
  removeCustomer: (id: string) => void;
  upsertRfq: (r: Rfq) => void;
  removeRfq: (id: string) => void;
  upsertUser: (u: SafeUser) => void;
  removeUser: (id: string) => void;
  setPurchasingContact: (c: PurchasingContact) => void;
  refetchProspects: () => Promise<void>;
  refetchCustomers: () => Promise<void>;
  loadUsers: () => Promise<void>;

  toast: (message: string, type?: Toast['type']) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useDataStore = create<DataState>((set, get) => ({
  currentUser: null,
  prospects: [],
  customers: [],
  rfqs: [],
  users: [],
  purchasingContact: { wa: '', email: '' },
  loaded: false,
  toasts: [],

  bootstrap: async () => {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) return;
    const data = await res.json();
    set({
      currentUser: data.user,
      prospects: data.prospects,
      customers: data.customers,
      rfqs: data.rfqs,
      purchasingContact: data.purchasingContact,
      loaded: true,
    });
  },

  setCurrentUser: (u) => set({ currentUser: u }),

  upsertProspect: (p) =>
    set((s) => {
      const idx = s.prospects.findIndex((x) => x.id === p.id);
      if (idx === -1) return { prospects: [p, ...s.prospects] };
      const next = s.prospects.slice();
      next[idx] = p;
      return { prospects: next };
    }),
  removeProspect: (id) => set((s) => ({ prospects: s.prospects.filter((x) => x.id !== id) })),

  upsertCustomer: (c) =>
    set((s) => {
      const idx = s.customers.findIndex((x) => x.id === c.id);
      if (idx === -1) return { customers: [c, ...s.customers] };
      const next = s.customers.slice();
      next[idx] = c;
      return { customers: next };
    }),
  removeCustomer: (id) => set((s) => ({ customers: s.customers.filter((x) => x.id !== id) })),

  upsertRfq: (r) =>
    set((s) => {
      const idx = s.rfqs.findIndex((x) => x.id === r.id);
      if (idx === -1) return { rfqs: [r, ...s.rfqs] };
      const next = s.rfqs.slice();
      next[idx] = r;
      return { rfqs: next };
    }),
  removeRfq: (id) => set((s) => ({ rfqs: s.rfqs.filter((x) => x.id !== id) })),

  upsertUser: (u) =>
    set((s) => {
      const idx = s.users.findIndex((x) => x.id === u.id);
      if (idx === -1) return { users: [...s.users, u] };
      const next = s.users.slice();
      next[idx] = u;
      return { users: next };
    }),
  removeUser: (id) => set((s) => ({ users: s.users.filter((x) => x.id !== id) })),

  setPurchasingContact: (c) => set({ purchasingContact: c }),

  refetchProspects: async () => {
    const res = await fetch('/api/prospects');
    if (!res.ok) return;
    const data = await res.json();
    set({ prospects: data.prospects });
  },
  refetchCustomers: async () => {
    const res = await fetch('/api/customers');
    if (!res.ok) return;
    const data = await res.json();
    set({ customers: data.customers });
  },
  loadUsers: async () => {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    const data = await res.json();
    set({ users: data.users });
  },

  toast: (message, type = 'info') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
