import { create } from 'zustand';
import type { BudgetTarget, Customer, Fupa, Prospect, PurchasingContact, Rfq, SafeUser, Vendor } from '@/lib/types';

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
  fupas: Fupa[];
  vendors: Vendor[];
  budgetTargets: BudgetTarget[];
  users: SafeUser[]; // only populated for admins when Kelola User modal opens
  purchasingContact: PurchasingContact;
  loaded: boolean;
  toasts: Toast[];

  bootstrap: () => Promise<void>;
  /** Wipes all cached data — call on logout so the next user never sees
      the previous one's records, and no stale role drives a redirect. */
  reset: () => void;
  setCurrentUser: (u: SafeUser | null) => void;

  upsertProspect: (p: Prospect) => void;
  removeProspect: (id: string) => void;
  upsertCustomer: (c: Customer) => void;
  removeCustomer: (id: string) => void;
  upsertRfq: (r: Rfq) => void;
  removeRfq: (id: string) => void;
  upsertFupa: (f: Fupa) => void;
  removeFupa: (id: string) => void;
  refetchFupas: () => Promise<void>;
  upsertBudgetTarget: (b: BudgetTarget) => void;
  upsertVendor: (v: Vendor) => void;
  removeVendor: (id: string) => void;
  refetchVendors: () => Promise<void>;
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
  fupas: [],
  vendors: [],
  budgetTargets: [],
  users: [],
  purchasingContact: { wa: '', email: '' },
  loaded: false,
  toasts: [],

  reset: () =>
    set({
      currentUser: null,
      prospects: [],
      customers: [],
      rfqs: [],
      fupas: [],
      vendors: [],
      budgetTargets: [],
      users: [],
      purchasingContact: { wa: '', email: '' },
      loaded: false,
      toasts: [],
    }),

  bootstrap: async () => {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) return;
    const data = await res.json();
    set({
      currentUser: data.user,
      prospects: data.prospects,
      customers: data.customers,
      rfqs: data.rfqs,
      fupas: data.fupas ?? [],
      vendors: data.vendors ?? [],
      budgetTargets: data.budgetTargets ?? [],
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

  upsertFupa: (f) =>
    set((s) => {
      const idx = s.fupas.findIndex((x) => x.id === f.id);
      if (idx === -1) return { fupas: [f, ...s.fupas] };
      const next = s.fupas.slice();
      next[idx] = f;
      return { fupas: next };
    }),
  removeFupa: (id) => set((s) => ({ fupas: s.fupas.filter((x) => x.id !== id) })),
  refetchFupas: async () => {
    const res = await fetch('/api/fupas');
    if (!res.ok) return;
    const data = await res.json();
    set({ fupas: data.fupas });
  },

  upsertBudgetTarget: (b) =>
    set((s) => {
      const idx = s.budgetTargets.findIndex((x) => x.cabang === b.cabang && x.periode === b.periode);
      if (idx === -1) return { budgetTargets: [...s.budgetTargets, b] };
      const next = s.budgetTargets.slice();
      next[idx] = b;
      return { budgetTargets: next };
    }),

  upsertVendor: (v) =>
    set((s) => {
      const idx = s.vendors.findIndex((x) => x.id === v.id);
      // Vendors render as an alphabetical directory, so keep the list sorted
      // rather than prepending the way the dated entities do.
      const next = idx === -1 ? [...s.vendors, v] : s.vendors.map((x) => (x.id === v.id ? v : x));
      return { vendors: next.sort((a, b) => a.nama.localeCompare(b.nama)) };
    }),
  removeVendor: (id) => set((s) => ({ vendors: s.vendors.filter((x) => x.id !== id) })),

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
  refetchVendors: async () => {
    const res = await fetch('/api/vendors');
    if (!res.ok) return;
    const data = await res.json();
    set({ vendors: data.vendors });
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
