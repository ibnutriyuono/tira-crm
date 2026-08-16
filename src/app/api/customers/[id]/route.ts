import { NextResponse } from 'next/server';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      name,
      cabang: String(body?.cabang || '').trim().toUpperCase(),
      pic: String(body?.pic || '').trim(),
      phone: String(body?.phone || '').trim(),
      email: String(body?.email || '').trim(),
      address: String(body?.address || '').trim(),
      catatan: String(body?.catatan || '').trim(),
    },
  });

  emitCrmEvent('customer:updated', customer);
  return NextResponse.json({ customer });
}

// Follow-up modal can update just the phone number without opening the full edit form.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.phone !== 'string') return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  const customer = await prisma.customer.update({ where: { id }, data: { phone: body.phone } });
  emitCrmEvent('customer:updated', customer);
  return NextResponse.json({ customer });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;

  await prisma.customer.delete({ where: { id } });
  emitCrmEvent('customer:deleted', { id });
  return NextResponse.json({ ok: true });
}
