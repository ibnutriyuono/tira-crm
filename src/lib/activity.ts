import { headers } from 'next/headers';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import type { ActivityChanges, ActivityAction, ActivityEntity, SafeUser } from './types';

interface LogInput {
  /** Null only for a failed login, where no session exists yet. */
  user: SafeUser | null;
  /** Attempted username — required when `user` is null. */
  username?: string;
  action: ActivityAction;
  entity: ActivityEntity;
  entityId?: string | null;
  summary: string;
  changes?: ActivityChanges | null;
}

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    // nginx sets X-Forwarded-For; the left-most entry is the original client.
    const fwd = h.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return h.get('x-real-ip');
  } catch {
    return null;
  }
}

/**
 * Appends one row to the audit trail and pushes it to every connected client.
 *
 * Deliberately swallows its own errors: an audit write must never turn a
 * successful mutation into a failed request. A dropped log line is logged to
 * stderr instead so it still shows up in `docker compose logs`.
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    const { user } = input;
    await prisma.activityLog.create({
      data: {
        userId: user?.id ?? null,
        username: user?.username ?? input.username ?? 'unknown',
        actorName: user?.name ?? input.username ?? 'unknown',
        role: user?.role ?? null,
        actorCabang: user?.cabang ?? null,
        actorReg: user?.reg ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary,
        changes: input.changes ? (input.changes as object) : undefined,
        ip: await clientIp(),
      },
    });
    // Deliberately a content-free ping: the row itself would be broadcast to
    // every connected browser, including users whose scope forbids reading it
    // (see activityScopeWhere). Listeners refetch through GET /api/activity,
    // which applies that scope server-side.
    emitCrmEvent('activity:created', { at: new Date().toISOString() });
  } catch (err) {
    console.error('[activity] failed to write audit log:', err);
  }
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * Field-level before/after diff, restricted to the keys of `labels` so that
 * derived columns (line/uraian/qty/value, updatedAt, …) don't produce noise.
 * Returns null when nothing in the watched set changed.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): ActivityChanges | null {
  const changes: ActivityChanges = {};
  for (const key of Object.keys(labels)) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    // JSON compare so Json columns (materials, items) and arrays are handled
    // by value rather than by reference.
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = { label: labels[key], from, to };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export const PROSPECT_FIELD_LABELS: Record<string, string> = {
  reg: 'Regional',
  cabang: 'Cabang',
  se: 'SE',
  customer: 'Customer',
  phone: 'No. WhatsApp',
  tglPenawaran: 'Tgl. Penawaran',
  noPo: 'No. PO',
  tglPO: 'Tgl. PO',
  tglDelivery: 'Tgl. Delivery',
  materials: 'Material',
  kondisiStock: 'Kondisi Stock',
  keterangan: 'Keterangan',
  status: 'Status',
  penawaranTerkirim: 'Status Penawaran',
  qcdQuality: 'QCD Quality',
  qcdCost: 'QCD Cost',
  qcdDelivery: 'QCD Delivery',
  qcdKompetitor: 'QCD Kompetitor',
  qcdCatatan: 'QCD Catatan',
  followUpAt: 'Jadwal Follow-up',
  followUpNote: 'Catatan Follow-up',
};

export const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  name: 'Nama',
  cabang: 'Cabang',
  pic: 'PIC',
  phone: 'No. WhatsApp',
  email: 'Email',
  address: 'Alamat',
  catatan: 'Catatan',
  pics: 'Daftar PIC',
};

export const FUPA_FIELD_LABELS: Record<string, string> = {
  noFupa: 'No. FUP A',
  tglFupa: 'Tgl. FUP A',
  sourceNoRfq: 'Ref. RFQ',
  cabang: 'Cabang',
  reg: 'Regional',
  customer: 'Customer',
  requestedBy: 'Diminta Oleh',
  items: 'Item',
  catatan: 'Catatan',
  status: 'Status',
  purchStatus: 'Status Pembelian',
};

export const VENDOR_FIELD_LABELS: Record<string, string> = {
  nama: 'Nama Vendor',
  pic: 'PIC',
  wa: 'No. WhatsApp',
  email: 'Email',
  kategori: 'Kategori',
  alamat: 'Alamat',
  catatan: 'Catatan',
};

export const RFQ_FIELD_LABELS: Record<string, string> = {
  noRfq: 'No. RFQ',
  tglRfq: 'Tgl. RFQ',
  cabang: 'Cabang',
  reg: 'Regional',
  customer: 'Customer',
  requestedBy: 'Diminta Oleh',
  items: 'Item',
  status: 'Status',
  purchStatus: 'Status Pembelian',
  fupaId: 'FUP A Terkait',
  jawabanRfqDikirim: 'Jawaban RFQ Terkirim',
};

export const USER_FIELD_LABELS: Record<string, string> = {
  name: 'Nama',
  role: 'Role',
  se: 'SE',
  cabang: 'Cabang',
  reg: 'Regional',
  passwordHash: 'Password',
};

/**
 * Who may read whose activity — mirrors prospectScopeWhere's philosophy:
 * admin/gm see the whole company, rm their region, bm their branch, sales
 * only themselves. Everyone can always see their own actions, which is why
 * each scoped branch ORs in `userId`.
 */
export function activityScopeWhere(user: SafeUser) {
  if (user.role === 'admin' || user.role === 'gm') return {};
  if (user.role === 'rm') return { OR: [{ actorReg: user.reg ?? -1 }, { userId: user.id }] };
  if (user.role === 'bm') {
    return { OR: [{ actorCabang: { equals: user.cabang || '', mode: 'insensitive' as const } }, { userId: user.id }] };
  }
  return { userId: user.id };
}
