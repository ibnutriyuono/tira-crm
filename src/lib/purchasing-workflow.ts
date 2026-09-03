import type { Fupa, Rfq, RfqItem } from './types';

/**
 * Automatic 5-stage Purchasing status for a document — distinct from the
 * legacy `purchStatus` ladder, which is no longer surfaced anywhere.
 *
 *   1 Baru       belum ada tindakan
 *   2 Diterima   Purchasing sudah membuka detail dokumennya
 *   3 Dijawab    jawaban sudah diisi (otomatis, tidak bisa diset manual)
 *   4 Selesai    dokumen ditandai selesai
 *   5 No Quote   tidak ada vendor yang bisa memberi harga (satu-satunya
 *                tahap manual, dicentang sendiri oleh Purchasing)
 *
 * Dijawab/Selesai outrank No Quote so a document that got resolved never
 * slides back to No Quote because the flag was set earlier.
 */
export type WorkflowStage = 1 | 2 | 3 | 4 | 5;

export const WORKFLOW_META: Record<WorkflowStage, { label: string; color: string }> = {
  1: { label: '1. Baru', color: 'slate' },
  2: { label: '2. Diterima', color: 'steel' },
  3: { label: '3. Dijawab', color: 'amber' },
  4: { label: '4. Selesai', color: 'green' },
  5: { label: '5. No Quote', color: 'rust' },
};

/** Stage order used by the dashboard KPI row and the status filter. */
export const WORKFLOW_STAGES: WorkflowStage[] = [1, 2, 3, 4, 5];

/**
 * The minimum a record needs for staging. Satisfied both by the board's own
 * row type and by a raw Rfq/Fupa, so the badge can be counted anywhere.
 */
export interface WorkflowDoc {
  jenis: 'RFQ' | 'FUPA';
  status: string;
  items: Pick<RfqItem, 'hargaPurchasing' | 'coo' | 'noQuote'>[];
  openedByPurchasingAt: string | null;
  noQuote: boolean;
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
  // No Quote is a per-material flag now, so the document only counts as No
  // Quote when *every* material is unquotable — a partly quotable RFQ still has
  // a real answer to send and shouldn't be filed as a dead end. The old
  // document-level flag is still honoured for records marked before the change.
  const mats = d.items;
  if ((mats.length > 0 && mats.every((m) => m.noQuote)) || d.noQuote) return 5;
  if (d.openedByPurchasingAt) return 2;
  return 1;
}

export function rfqAsWorkflowDoc(r: Rfq): WorkflowDoc {
  return {
    jenis: 'RFQ',
    status: r.status,
    items: r.items ?? [],
    openedByPurchasingAt: r.openedByPurchasingAt,
    noQuote: r.noQuote,
  };
}

export function fupaAsWorkflowDoc(f: Fupa): WorkflowDoc {
  return {
    jenis: 'FUPA',
    status: f.status,
    items: f.items ?? [],
    openedByPurchasingAt: f.openedByPurchasingAt,
    noQuote: f.noQuote,
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
