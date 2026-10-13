import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canManageKam, cleanGroupInput, dedupeEntities, entityConflicts } from '@/lib/kam';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';

/**
 * Key Account groups. Everyone with sales data reads them (badges, Kanban,
 * Customer Intelligence); only GM / RM / Admin create or restructure.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kam', 'v');
  if (denied) return denied;
  if (user.role === 'purchasing05') return NextResponse.json({ groups: [] });
  const groups = await prisma.customerGroup.findMany({ orderBy: [{ skor: 'desc' }, { name: 'asc' }] });
  return NextResponse.json({ groups });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kam', 'e');
  if (denied) return denied;
  if (!canManageKam(user.role)) return NextResponse.json({ error: 'Hanya GM, RM dan Admin yang dapat mengelola Key Account.' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const data = cleanGroupInput(body || {});
  if (!data.name) return NextResponse.json({ error: 'Nama grup wajib diisi' }, { status: 400 });
  const exists = await prisma.customerGroup.findUnique({ where: { name: data.name } });
  if (exists) return NextResponse.json({ error: `Grup "${data.name}" sudah ada` }, { status: 409 });
  if (data.entities) {
    data.entities = dedupeEntities(data.entities);
    const others = await prisma.customerGroup.findMany({ select: { id: true, name: true, entities: true } });
    const clash = entityConflicts(data.entities, others as never);
    if (clash.length) return NextResponse.json({ error: `Perusahaan sudah masuk grup lain: ${clash.join(', ')}` }, { status: 409 });
  }
  const tier = data.tier || 'monitor';
  const group = await prisma.customerGroup.create({
    data: {
      ...(data as Record<string, unknown>),
      name: data.name,
      tier,
      tierHistory: [{ at: new Date().toISOString(), from: null, to: tier, reason: String(body?.tierReason || 'Grup dibuat'), by: user.name }],
    } as never,
  });
  emitCrmEvent('customerGroup:updated', group);
  await logActivity({ user, action: 'create', entity: 'customerGroup', entityId: group.id, summary: `Membuat grup Key Account "${group.name}" (${tier})` });
  return NextResponse.json({ group }, { status: 201 });
}
