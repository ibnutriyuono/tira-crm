import type { Fupa, Rfq, RfqItem } from './types';

/**
 * Simplified 4-stage document workflow for Purchasing's "Permintaan Masuk"
 * list — distinct from purchStatus (0-5, which tracks the *vendor quotation*
 * process and is still shown and editable in the detail modal). This one
 * tracks where the document itself sits in Purchasing's own queue:
 * 1 Diterima (baru masuk, belum ada tindakan) -> 2 Diproses (Purchasing sudah
 * mulai bekerja: ada catatan, atau status vendor sudah digerakkan) ->
 * 3 Dijawab (otomatis, tidak bisa diset manual) -> 4 Selesai.
 */
export type WorkflowStage = 1 | 2 | 3 | 4;

export const WORKFLOW_META: Record<WorkflowStage, { label: string; color: string }> = {
  1: { label: '1. Diterima', color: 'slate' },
  2: { label: '2. Diproses', color: 'steel' },
  3: { label: '3. Dijawab', color: 'amber' },
  4: { label: '4. Selesai', color: 'green' },
};

/**
 * The minimum a record needs for staging. Satisfied both by the board's own
 * row type and by a raw Rfq/Fupa, so the badge can be counted without the
 * board's quotation tally.
 */
export interface WorkflowDoc {
  jenis: 'RFQ' | 'FUPA';
  status: string;
  purchStatus: number;
  purchNotes: string | null;
  items: Pick<RfqItem, 'hargaPurchasing' | 'coo'>[];
  /** FUP A only — see below. */
  jawabanFupaDikirim?: boolean;
}

export function workflowStage(d: WorkflowDoc): WorkflowStage {
  if (d.status === 'Selesai') return 4;
  // An RFQ is answered once Purchasing fills Harga/COO on any line. FUP A has
  // no such structured pricing step — its answer is the free-text purchJawaban,
  // which is what jawabanFupaDikirim records.
  const answered = d.jenis === 'RFQ' ? d.items.some((m) => m.hargaPurchasing || m.coo) : !!d.jawabanFupaDikirim;
  if (answered) return 3;
  // Requesting a quotation moves purchStatus to PSTATUS_DIMINTA server-side, so
  // purchStatus already covers the "penawaran sudah diminta" case on its own.
  if (d.purchStatus > 0 || (d.purchNotes || '').trim() !== '') return 2;
  return 1;
}

export function rfqAsWorkflowDoc(r: Rfq): WorkflowDoc {
  return { jenis: 'RFQ', status: r.status, purchStatus: r.purchStatus ?? 0, purchNotes: r.purchNotes, items: r.items ?? [] };
}

export function fupaAsWorkflowDoc(f: Fupa): WorkflowDoc {
  return {
    jenis: 'FUPA',
    status: f.status,
    purchStatus: f.purchStatus ?? 0,
    purchNotes: f.purchNotes,
    items: f.items ?? [],
    jawabanFupaDikirim: f.jawabanFupaDikirim,
  };
}

/**
 * RFQ + FUP A still at stage 1 — handed to Purchasing but not yet touched.
 * Drafts are excluded: they were never sent, so they aren't Purchasing's queue.
 */
export function countNewPurchasingItems(rfqs: Rfq[], fupas: Fupa[]): number {
  const pending = (d: WorkflowDoc, isDraft: boolean) => !isDraft && workflowStage(d) === 1;
  return (
    rfqs.filter((r) => pending(rfqAsWorkflowDoc(r), r.status === 'Draft')).length +
    fupas.filter((f) => pending(fupaAsWorkflowDoc(f), f.status === 'Draft')).length
  );
}
