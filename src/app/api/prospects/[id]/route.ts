import { NextResponse } from 'next/server';
import { ensureCustomerFromProspect } from '@/lib/customer-sync';
import { syncFollowUpPlan } from '@/lib/followup-activity';
import { diffFields, logActivity, PROSPECT_FIELD_LABELS } from '@/lib/activity';
import { cleanFaktor, cleanLevel, type QcdInput } from '@/lib/qcd';
import { deriveFromMaterials, requireQcdOnClose, isResponse, requireNoPoOnMoveToPo, requireUser, resolveProspectScope } from '@/lib/api-helpers';
import { STATUS_META } from '@/lib/constants';
import { canDeleteProspect } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Material, SafeUser } from '@/lib/types';

/** The record's QCD as it will be after this request: request values win, existing ones fill the gaps. */
function mergeQcd(existing: Record<string, unknown> | null | undefined, body: Record<string, unknown> | null): QcdInput {
  const pick = (k: string) => (body && Object.prototype.hasOwnProperty.call(body, k) ? body[k] : existing?.[k]);
  return { qcdQualityLevel: pick('qcdQualityLevel'), qcdCostLevel: pick('qcdCostLevel'), qcdDeliveryLevel: pick('qcdDeliveryLevel'), qcdFaktor: pick('qcdFaktor'), qcdKompetitor: pick('qcdKompetitor') };
}

const statusLabel = (v: unknown) => STATUS_META[Number(v)]?.label ?? String(v);

async function assertInScope(user: SafeUser, id: string) {
  const existing = await prisma.prospect.findUnique({ where: { id } });
  if (!existing) return { error: NextResponse.json({ error: 'Prospek tidak ditemukan' }, { status: 404 }) };
  if (user.role === 'sales' && (existing.se || '').toUpperCase() !== (user.se || '').toUpperCase()) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  if (user.role === 'bm' && (existing.cabang || '').toUpperCase() !== (user.cabang || '').toUpperCase()) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  if (user.role === 'rm' && String(existing.reg || '') !== String(user.reg || '')) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  return { existing };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const scoped = await assertInScope(user, id);
  if (scoped.error) return scoped.error;

  const body = await req.json().catch(() => null);
  const customer = String(body?.customer || '').trim();
  if (!customer) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  const materials: Material[] = Array.isArray(body?.materials) ? body.materials : [];
  if (!materials.some((m) => (m.uraian || '').trim())) {
    return NextResponse.json({ error: 'Isi minimal satu uraian material' }, { status: 400 });
  }
  const derived = deriveFromMaterials(materials);

  const status = Number(body?.status) || 0;
  const noPo = String(body?.noPo || '').trim();
  const poErr = requireNoPoOnMoveToPo(Number(scoped.existing.status), status, noPo);
  if (poErr) return poErr;
  const qcdErr = requireQcdOnClose(Number(scoped.existing.status), status, mergeQcd(scoped.existing, body));
  if (qcdErr) return qcdErr;

  // Locked scope fields come from the account, not the request — see
  // api-helpers.ts#prospectScopeLocks.
  const { reg, cabang, se } = await resolveProspectScope(user, body);

  const prospect = await prisma.prospect.update({
    where: { id },
    data: {
      reg,
      cabang,
      se,
      customer,
      phone: String(body?.phone || '').trim(),
      tglPenawaran: body?.tglPenawaran || null,
      noPo: noPo || null,
      tglPO: body?.tglPO || null,
      tglDelivery: body?.tglDelivery || null,
      ...derived,
      kondisiStock: String(body?.kondisiStock || '').trim(),
      keterangan: String(body?.keterangan || '').trim(),
      status,
      penawaranTerkirim: !!body?.penawaranTerkirim,
      terfaktur: !!body?.terfaktur,
      qcdQuality: body?.qcdQuality ?? undefined,
      qcdCost: body?.qcdCost ?? undefined,
      qcdDelivery: body?.qcdDelivery ?? undefined,
      qcdKompetitor: body?.qcdKompetitor ?? undefined,
      qcdCatatan: body?.qcdCatatan ?? undefined,
      qcdQualityLevel: body?.qcdQualityLevel !== undefined ? cleanLevel(body.qcdQualityLevel) : undefined,
      qcdCostLevel: body?.qcdCostLevel !== undefined ? cleanLevel(body.qcdCostLevel) : undefined,
      qcdDeliveryLevel: body?.qcdDeliveryLevel !== undefined ? cleanLevel(body.qcdDeliveryLevel) : undefined,
      qcdFaktor: body?.qcdFaktor !== undefined ? cleanFaktor(body.qcdFaktor) : undefined,
    },
  });

  emitCrmEvent('prospect:updated', prospect);
  // Customer typed in Edit Prospek -> Kelola Customer (created / phone filled).
  await ensureCustomerFromProspect(user, prospect);
  await logActivity({
    user,
    action: 'update',
    entity: 'prospect',
    entityId: prospect.id,
    summary: `Mengubah prospek "${prospect.customer}"`,
    changes: diffFields(scoped.existing, prospect, PROSPECT_FIELD_LABELS),
  });
  return NextResponse.json({ prospect });
}

// Partial update — used for lightweight mutations that shouldn't require the
// full form payload: kanban drag status change, QCD popup save, phone edit
// from the follow-up modal, and "mark quotation sent".
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const scoped = await assertInScope(user, id);
  if (scoped.error) return scoped.error;

  const body = await req.json().catch(() => null);
  const data: Record<string, unknown> = {};
  const allowed = ['status', 'noPo', 'penawaranTerkirim', 'terfaktur', 'phone', 'qcdQuality', 'qcdCost', 'qcdDelivery', 'qcdKompetitor', 'qcdCatatan', 'qcdQualityLevel', 'qcdCostLevel', 'qcdDeliveryLevel', 'qcdFaktor', 'followUpAt', 'followUpNote'];
  for (const key of allowed) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key];
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  // Aging measures time without progress, so the clock only resets on a real
  // status move — not when a note or phone number is edited.
  if ('status' in data && Number(data.status) !== Number(scoped.existing?.status)) {
    data.statusChangedAt = new Date();
  }

  // Same PO gate as the full form (POST/PUT), applied here too since this is
  // exactly the endpoint the Kanban drag and the inline status dropdown use
  // to move status without going through the form at all — a partial PATCH
  // is the one path a "wajib" rule at the form level alone wouldn't cover.
  // Only checked when `status` is actually part of THIS request and is
  // really changing (mirrors the aging-clock check just above), so editing
  // an unrelated field on an old record already sitting at 4/5 without a
  // noPo on file is never blocked by this.
  if ('status' in data) {
    const nextNoPo = 'noPo' in data ? data.noPo : scoped.existing?.noPo;
    const poErr = requireNoPoOnMoveToPo(Number(scoped.existing?.status), Number(data.status), nextNoPo);
    if (poErr) return poErr;
    const qcdErr = requireQcdOnClose(Number(scoped.existing?.status), Number(data.status), mergeQcd(scoped.existing, data));
    if (qcdErr) return qcdErr;
  }
  for (const k of ['qcdQualityLevel', 'qcdCostLevel', 'qcdDeliveryLevel'] as const) if (k in data) data[k] = cleanLevel(data[k]);
  if ('qcdFaktor' in data) data.qcdFaktor = cleanFaktor(data.qcdFaktor);
  if (typeof data.noPo === 'string') data.noPo = data.noPo.trim() || null;

  const prospect = await prisma.prospect.update({ where: { id }, data });
  emitCrmEvent('prospect:updated', prospect);

  // Follow-up schedule changed: keep its "rencana" row in Aktivitas Harian in
  // step. Best-effort -- the schedule itself is already saved.
  if ('followUpAt' in data || 'followUpNote' in data) {
    try {
      await syncFollowUpPlan(user, prospect);
    } catch (err) {
      console.error('[follow-up] gagal sinkron rencana aktivitas', err);
    }
  }

  // A bare status flip is the kanban drag (or the inline status dropdown), and
  // it's the single most useful thing to see in the audit trail — give it its
  // own action and a summary that names both ends of the move.
  const changes = diffFields(scoped.existing, prospect, PROSPECT_FIELD_LABELS);
  const movedStatus = changes?.status;
  await logActivity({
    user,
    action: movedStatus ? 'status_change' : 'update',
    entity: 'prospect',
    entityId: prospect.id,
    summary: movedStatus
      ? `Memindahkan prospek "${prospect.customer}" dari "${statusLabel(movedStatus.from)}" ke "${statusLabel(movedStatus.to)}"`
      : changes?.penawaranTerkirim
        ? `Menandai penawaran prospek "${prospect.customer}" sebagai ${prospect.penawaranTerkirim ? 'Terkirim' : 'Pending'}`
        : changes?.followUpAt
          ? `Menjadwalkan follow-up prospek "${prospect.customer}" pada ${prospect.followUpAt || '-'}`
          : `Mengubah prospek "${prospect.customer}"`,
    changes,
  });
  return NextResponse.json({ prospect });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canDeleteProspect(user)) {
    return NextResponse.json({ error: 'Hanya role GM dan Admin yang dapat menghapus prospek.' }, { status: 403 });
  }
  const { id } = await params;

  const scoped = await assertInScope(user, id);
  if (scoped.error) return scoped.error;

  await prisma.prospect.delete({ where: { id } });
  emitCrmEvent('prospect:deleted', { id });
  await logActivity({
    user,
    action: 'delete',
    entity: 'prospect',
    entityId: id,
    summary: `Menghapus prospek "${scoped.existing.customer}"`,
  });
  return NextResponse.json({ ok: true });
}
