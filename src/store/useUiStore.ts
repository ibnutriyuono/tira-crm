import { create } from 'zustand';

export type ModalKey =
  | 'prospectForm'
  | 'import'
  | 'delete'
  | 'cancelDoc'
  | 'followUp'
  | 'users'
  | 'userForm'
  | 'customers'
  | 'customerForm'
  | 'database'
  | 'dbImportConfirm'
  | 'rfqManage'
  | 'rfq'
  | 'qcd'
  | 'quotation'
  | 'activity'
  | 'vendors'
  | 'vendorForm'
  | 'fupa'
  | 'fupaManage'
  | 'purchasing'
  | 'marketing'
  | 'customerIntel'
  | 'competitorLog'
  | 'forecast'
  | 'qcdRecap'
  | 'salesPlan'
  | 'notifications'
  | 'followUpBoard'
  | 'gmAnalysis'
  | null;

export type DeleteMode = 'prospect' | 'user' | 'customer' | 'rfq' | 'vendor' | 'fupa';

export interface CancelDocCtx {
  jenis: 'RFQ' | 'FUPA';
  id: string;
  noDoc: string | null;
  customer: string | null;
  /** true = dokumen sedang dibatalkan, modal menawarkan pengaktifan kembali. */
  cancelled: boolean;
}
export interface DeleteCtx {
  mode: DeleteMode;
  id: string;
  title: string;
  message: string;
}
export interface FollowUpCtx {
  type: 'prospect' | 'customer';
  id: string;
}
export interface SalesPlanCtx {
  se: string;
  cabang: string;
  periode: string;
}
export interface QcdCtx {
  mode: 'prospectForm' | 'kanban';
  statusVal: number;
  recordId: string | null;
}
export interface RfqCtx {
  prospectId: string | null;
  rfqId: string | null;
}

export const VIEW_STATE_FIELDS = ['viewMode', 'fReg', 'fCabang', 'fSe', 'fKlas', 'fStatus', 'fPenawaran', 'fBulan', 'fTahun', 'pageSize', 'sortKey', 'sortDir'] as const;
const VIEW_STATE_KEY = 'crm_view_state_v1';

interface UiState {
  // filters / sort / pagination / view mode — persisted to localStorage
  viewMode: 'table' | 'card';
  search: string;
  fReg: string;
  fCabang: string;
  fSe: string;
  fKlas: string;
  fStatus: string;
  fPenawaran: string;
  fBulan: string;
  fTahun: string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number | 'all';

  setFilter: (patch: Partial<UiState>) => void;
  resetFilters: () => void;
  hydrateViewState: () => void;
  persistViewState: () => void;

  // modal / context state
  modal: ModalKey;
  editProspectId: string | null;
  deleteCtx: DeleteCtx | null;
  cancelDocCtx: CancelDocCtx | null;
  followUpCtx: FollowUpCtx | null;
  salesPlanCtx: SalesPlanCtx | null;
  userEditId: string | null;
  customerEditId: string | null;
  vendorEditId: string | null;
  /** `sourceRfqId` promotes a won RFQ; `prospectId` starts one straight from a
      Kanban card, where there is no RFQ to carry the header over from. */
  fupaCtx: { fupaId: string | null; sourceRfqId: string | null; prospectId?: string | null } | null;
  quotationProspectId: string | null;
  rfqCtx: RfqCtx | null;
  /** Ask the purchasing board to open one document's detail. Set from outside
      the board (a notification toast); the board consumes and clears it. */
  purchDetailCtx: { jenis: 'RFQ' | 'FUPA'; id: string } | null;
  qcdCtx: QcdCtx | null;
  importTarget: 'prospect' | 'customer' | 'vendor';
  /** Staged QCD answers for a prospect still being created/edited in the form modal — committed together on Save. */
  pendingProspectQCD: { quality: string; cost: string; delivery: string; kompetitor: string; catatan: string };

  openModal: (m: ModalKey) => void;
  closeModal: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>((set, get) => ({
  viewMode: 'table',
  search: '',
  fReg: '',
  fCabang: '',
  fSe: '',
  fKlas: '',
  fStatus: '',
  fPenawaran: '',
  fBulan: '',
  fTahun: '',
  sortKey: 'tglPenawaran',
  sortDir: 'desc',
  page: 1,
  pageSize: 25,

  setFilter: (patch) => {
    set({ ...patch, page: 'page' in patch ? patch.page : 1 } as Partial<UiState>);
    get().persistViewState();
  },
  resetFilters: () => {
    set({ fReg: '', fCabang: '', fSe: '', fKlas: '', fStatus: '', fPenawaran: '', fBulan: '', fTahun: '', search: '', page: 1 });
    get().persistViewState();
  },
  hydrateViewState: () => {
    try {
      const raw = window.localStorage.getItem(VIEW_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const patch: Partial<UiState> = {};
        for (const key of VIEW_STATE_FIELDS) {
          if (parsed[key] !== undefined) (patch as Record<string, unknown>)[key] = parsed[key];
        }
        set(patch);
      }
    } catch {
      /* keep defaults */
    }
  },
  persistViewState: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snapshot: Record<string, unknown> = {};
      for (const key of VIEW_STATE_FIELDS) snapshot[key] = (get() as unknown as Record<string, unknown>)[key];
      try {
        window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(snapshot));
      } catch {
        /* non-critical */
      }
    }, 400);
  },

  modal: null,
  editProspectId: null,
  deleteCtx: null,
  cancelDocCtx: null,
  followUpCtx: null,
  salesPlanCtx: null,
  userEditId: null,
  customerEditId: null,
  vendorEditId: null,
  fupaCtx: null,
  quotationProspectId: null,
  rfqCtx: null,
  purchDetailCtx: null,
  qcdCtx: null,
  importTarget: 'prospect',
  pendingProspectQCD: { quality: '', cost: '', delivery: '', kompetitor: '', catatan: '' },

  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
}));
