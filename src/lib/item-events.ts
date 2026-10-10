import { prisma } from './prisma';
import { itemLabel, type EventType, type ItemEventLine } from './item-flow';
import type { Material, SafeUser } from './types';

/**
 * Server side of the per-item history (see lib/item-flow.ts). Best-effort like
 * logActivity: a failed history write never fails the save it describes.
 */
export async function logItemEvent(input: {
  prospectId: string;
  type: EventType;
  title: string;
  items: ItemEventLine[];
  user: SafeUser | null;
  tgl?: string | null;
  docNo?: string | null;
}): Promise<void> {
  if (!input.items.length) return;
  try {
    await prisma.prospectItemEvent.create({
      data: {
        prospectId: input.prospectId,
        type: input.type,
        title: input.title.slice(0, 200),
        items: input.items as unknown as object,
        tgl: input.tgl || null,
        docNo: input.docNo || null,
        userId: input.user?.id ?? null,
        actorName: input.user?.name ?? 'sistem',
      },
    });
  } catch (err) {
    console.error('[item-event] gagal mencatat riwayat item', err);
  }
}

type Row = Material & { itemId?: string; fabNama?: string };
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const today = () => new Date().toISOString().slice(0, 10);

/** "Penawaran dikirim": snapshot of every row's qty at that moment. */
export async function logPenawaranSent(user: SafeUser, prospectId: string, materials: unknown, tgl?: string | null): Promise<void> {
  const items = rows(materials).filter((m) => m.itemId).map((m) => ({ itemId: m.itemId as string, label: itemLabel(m), qty: Number(m.qty) || 0 }));
  await logItemEvent({ prospectId, type: 'tawar', title: 'Penawaran dikirim — qty ditawarkan tercatat', items, user, tgl: tgl || today() });
}

/** Rows added / removed / re-quantified by an edit after the quotation went out. */
export async function logMaterialRevision(user: SafeUser, prospectId: string, before: unknown, after: unknown): Promise<void> {
  const prev = new Map(rows(before).filter((m) => m.itemId).map((m) => [m.itemId as string, m]));
  // Old rows had no id yet: nothing to compare against.
  if (prev.size === 0) return;
  const next = rows(after).filter((m) => m.itemId);
  const items: ItemEventLine[] = [];
  next.forEach((m) => {
    const p = prev.get(m.itemId as string);
    const to = Number(m.qty) || 0;
    if (!p) items.push({ itemId: m.itemId as string, label: itemLabel(m), from: 0, to });
    else if ((Number(p.qty) || 0) !== to) items.push({ itemId: m.itemId as string, label: itemLabel(m), from: Number(p.qty) || 0, to });
    prev.delete(m.itemId as string);
  });
  prev.forEach((p, id) => items.push({ itemId: id, label: itemLabel(p), from: Number(p.qty) || 0, to: 0 }));
  await logItemEvent({ prospectId, type: 'revisi', title: 'Material penawaran diubah', items, user, tgl: today() });
}
