// Transient holder for a parsed .json backup file between DatabaseModal (where
// it's read) and DbImportConfirmModal (where the user confirms the restore).
// Deliberately outside any store — this payload can be a few MB of JSON and
// doesn't need to be reactive or trigger re-renders while it's just "pending".
export interface DbBackupPayload {
  app?: string;
  version?: number;
  exportedAt?: string;
  prospects: Record<string, unknown>[];
  customers?: Record<string, unknown>[];
  rfqs?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
}

let pending: DbBackupPayload | null = null;

export const pendingDbImport = {
  set(payload: DbBackupPayload | null) {
    pending = payload;
  },
  get(): DbBackupPayload | null {
    return pending;
  },
};
