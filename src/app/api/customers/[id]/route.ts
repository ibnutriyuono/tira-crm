import { NextResponse } from 'next/server';
import { CUSTOMER_FIELD_LABELS, diffFields, logActivity } from '@/lib/activity';
import { isResponse, normalizeCustomerPics, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { CustomerPic } from '@/lib/types';
import type { Prisma } from '@prisma/client';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });

  // Same mirroring as POST: `pics` is the source of truth going forward, the
  // legacy columns just follow the primary entry.
  const pics = normalizeCustomerPics(body?.pics);
  const primary = pics.find((p) => p.isPrimary);

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      name,
      cabang: String(body?.cabang || '').trim().toUpperCase(),
      pic: primary?.nama ?? String(body?.pic || '').trim(),
      phone: primary?.phone ?? String(body?.phone || '').trim(),
      email: primary?.email ?? String(body?.email || '').trim(),
      address: String(body?.address || '').trim(),
      catatan: String(body?.catatan || '').trim(),
      pics: pics as unknown as Prisma.InputJsonValue,
    },
  });

  emitCrmEvent('customer:updated', customer);
  await logActivity({
    user,
    action: 'update',
    entity: 'customer',
    entityId: customer.id,
    summary: `Mengubah customer "${customer.name}"`,
    changes: diffFields(existing, customer, CUSTOMER_FIELD_LABELS),
  });
  return NextResponse.json({ customer });
}

// Follow-up modal can update just the phone number without opening the full edit form.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.phone !== 'string') return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });

  // Keep the primary PIC's phone in step so a number fixed here (the quick
  // WhatsApp-send path) doesn't quietly drift from the PIC list.
  const existingPics = Array.isArray(existing.pics) ? (existing.pics as unknown as CustomerPic[]) : [];
  const pics = existingPics.length > 0
    ? existingPics.map((p) => (p.isPrimary ? { ...p, phone: body.phone } : p))
    : existingPics;

  const customer = await prisma.customer.update({
    where: { id },
    data: { phone: body.phone, ...(pics.length > 0 ? { pics: pics as unknown as Prisma.InputJsonValue } : {}) },
  });
  emitCrmEvent('customer:updated', customer);
  await logActivity({
    user,
    action: 'update',
    entity: 'customer',
    entityId: customer.id,
    summary: `Mengubah nomor WhatsApp customer "${customer.name}"`,
    changes: diffFields(existing, customer, CUSTOMER_FIELD_LABELS),
  });
  return NextResponse.json({ customer });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;

  const existing = await prisma.customer.findUnique({ where: { id } });
  await prisma.customer.delete({ where: { id } });
  emitCrmEvent('customer:deleted', { id });
  await logActivity({
    user,
    action: 'delete',
    entity: 'customer',
    entityId: id,
    summary: `Menghapus customer "${existing?.name ?? id}"`,
  });
  return NextResponse.json({ ok: true });
}
