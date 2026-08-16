import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { PurchasingContact } from '@/lib/types';

const KEY = 'purchasingContact';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const contact = (row?.value as unknown as PurchasingContact) || { wa: '', email: '' };
  return NextResponse.json({ purchasingContact: contact });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await req.json().catch(() => null);
  const contact: PurchasingContact = { wa: String(body?.wa || ''), email: String(body?.email || '') };
  const value = contact as unknown as Prisma.InputJsonValue;

  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value },
  });

  emitCrmEvent('purchasingContact:updated', contact);
  await logActivity({
    user,
    action: 'update',
    entity: 'setting',
    entityId: KEY,
    summary: `Mengubah kontak Purchasing (WA: ${contact.wa || '-'}, Email: ${contact.email || '-'})`,
  });
  return NextResponse.json({ purchasingContact: contact });
}
