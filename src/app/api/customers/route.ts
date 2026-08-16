import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ customers });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  const customer = await prisma.customer.create({
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

  emitCrmEvent('customer:created', customer);
  await logActivity({ user, action: 'create', entity: 'customer', entityId: customer.id, summary: `Menambah customer "${customer.name}"` });
  return NextResponse.json({ customer }, { status: 201 });
}
