import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, normalizeCustomerPics, requireUser } from '@/lib/api-helpers';
import { customerScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Prisma } from '@prisma/client';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const customers = await prisma.customer.findMany({ where: await customerScopeWhere(user), orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ customers });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  // The form now edits `pics` (name + jabatan + phone + email per contact);
  // the legacy single pic/phone/email columns are mirrored from whichever
  // entry is primary so older call sites that still read them directly keep
  // working. A form with no PIC rows yet (or posting the old shape directly)
  // falls back to whatever it sent for those fields.
  const pics = normalizeCustomerPics(body?.pics);
  const primary = pics.find((p) => p.isPrimary);

  const customer = await prisma.customer.create({
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

  emitCrmEvent('customer:created', customer);
  await logActivity({ user, action: 'create', entity: 'customer', entityId: customer.id, summary: `Menambah customer "${customer.name}"` });
  return NextResponse.json({ customer }, { status: 201 });
}
