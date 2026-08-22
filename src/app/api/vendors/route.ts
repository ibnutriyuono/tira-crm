import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  // Readable by everyone: sales and managers see which vendors were asked to
  // quote. Only purchasing/admin can write (see the guard in POST).
  const vendors = await prisma.vendor.findMany({ orderBy: { nama: 'asc' } });
  return NextResponse.json({ vendors });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengelola vendor.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const nama = String(body?.nama || '').trim();
  if (!nama) return NextResponse.json({ error: 'Nama vendor wajib diisi' }, { status: 400 });

  const vendor = await prisma.vendor.create({
    data: {
      nama,
      pic: String(body?.pic || '').trim(),
      wa: String(body?.wa || '').trim(),
      email: String(body?.email || '').trim(),
      kategori: String(body?.kategori || '').trim(),
      alamat: String(body?.alamat || '').trim(),
      catatan: String(body?.catatan || '').trim(),
    },
  });

  emitCrmEvent('vendor:created', vendor);
  await logActivity({ user, action: 'create', entity: 'vendor', entityId: vendor.id, summary: `Menambah vendor "${vendor.nama}"` });
  return NextResponse.json({ vendor }, { status: 201 });
}
