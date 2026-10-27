import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canManageKam, cleanGroupInput, dedupeEntities, entityConflicts } from '@/lib/kam';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { CustomerGroup, KamTierChange } from '@/lib/types';
import { guard } from '@/lib/permissions-server';
import { isGmLevel } from '@/lib/roles';

/** Fields the team lead (ketua grup) may change on their own: perusahaan, sekretaris, PIC, rencana aksi. */
const KETUA_FIELDS = ['actions', 'notes', 'reviewNext', 'sekretarisId', 'anggotaIds', 'entities'];

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kam', 'e');
  if (denied) return denied;
  const { id } = await params;
  const existing = (await prisma.customerGroup.findUnique({ where: { id } })) as unknown as CustomerGroup | null;
  if (!existing) return NextResponse.json({ error: 'Grup tidak ditemukan' }, { status: 404 });

  const manager = canManageKam(user.role);
  const ketua = existing.ketuaId === user.id;
  if (!manager && !ketua) return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 });

  const body = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const allowed = manager ? body : Object.fromEntries(Object.entries(body).filter(([k]) => KETUA_FIELDS.includes(k)));
  const data = cleanGroupInput(allowed) as Record<string, unknown>;
  if ('name' in data && !data.name) delete data.name;
  if (data.name && data.name !== existing.name) {
    const clash = await prisma.customerGroup.findUnique({ where: { name: data.name as string } });
    if (clash) return NextResponse.json({ error: `Grup "${data.name}" sudah ada` }, { status: 409 });
  }

  if (Array.isArray(data.entities)) {
    data.entities = dedupeEntities(data.entities as string[]);
    const others = await prisma.customerGroup.findMany({ select: { id: true, name: true, entities: true } });
    const clash = entityConflicts(data.entities as string[], others as never, id);
    if (clash.length) return NextResponse.json({ error: `Perusahaan sudah masuk grup lain: ${clash.join(', ')}` }, { status: 409 });
  }

  // A tier move is a management decision: keep it with its reason.
  if (data.tier && data.tier !== existing.tier) {
    const reason = String(body.tierReason || '').trim();
    if (!reason) return NextResponse.json({ error: 'Alasan perubahan tier wajib diisi' }, { status: 400 });
    const change: KamTierChange = { at: new Date().toISOString(), from: existing.tier, to: data.tier as CustomerGroup['tier'], reason: reason.slice(0, 300), by: user.name };
    data.tierHistory = [change, ...(Array.isArray(existing.tierHistory) ? existing.tierHistory : [])].slice(0, 50);
  }

  const group = await prisma.customerGroup.update({ where: { id }, data: data as never });
  emitCrmEvent('customerGroup:updated', group);
  await logActivity({
    user,
    action: 'update',
    entity: 'customerGroup',
    entityId: id,
    summary: data.tier && data.tier !== existing.tier ? `Mengubah tier "${existing.name}" dari ${existing.tier} ke ${data.tier}` : `Mengubah grup Key Account "${existing.name}"`,
  });
  return NextResponse.json({ group });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kam', 'd');
  if (denied) return denied;
  if (!isGmLevel(user.role) && user.role !== 'admin') return NextResponse.json({ error: 'Hanya GM dan Admin yang dapat menghapus grup.' }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.customerGroup.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Grup tidak ditemukan' }, { status: 404 });
  await prisma.customerGroup.delete({ where: { id } });
  emitCrmEvent('customerGroup:deleted', { id });
  await logActivity({ user, action: 'delete', entity: 'customerGroup', entityId: id, summary: `Menghapus grup Key Account "${existing.name}"` });
  return NextResponse.json({ ok: true });
}
