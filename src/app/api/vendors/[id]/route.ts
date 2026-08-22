import { NextResponse } from 'next/server';
import { diffFields, logActivity, VENDOR_FIELD_LABELS } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengelola vendor.' }, { status: 403 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const nama = String(body?.nama || '').trim();
  if (!nama) return NextResponse.json({ error: 'Nama vendor wajib diisi' }, { status: 400 });

  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Vendor tidak ditemukan' }, { status: 404 });

  const vendor = await prisma.vendor.update({
    where: { id },
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

  emitCrmEvent('vendor:updated', vendor);
  await logActivity({
    user,
    action: 'update',
    entity: 'vendor',
    entityId: vendor.id,
    summary: `Mengubah vendor "${vendor.nama}"`,
    changes: diffFields(existing, vendor, VENDOR_FIELD_LABELS),
  });
  return NextResponse.json({ vendor });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengelola vendor.' }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Vendor tidak ditemukan' }, { status: 404 });

  // Quotations reference the vendor with onDelete: Restrict — purchasing history
  // must survive. Explain that instead of letting the FK raise a 500.
  const quoteCount = await prisma.quotation.count({ where: { vendorId: id } });
  if (quoteCount > 0) {
    return NextResponse.json(
      { error: `Vendor "${existing.nama}" tidak dapat dihapus karena memiliki ${quoteCount} riwayat penawaran.` },
      { status: 409 },
    );
  }

  await prisma.vendor.delete({ where: { id } });
  emitCrmEvent('vendor:deleted', { id });
  await logActivity({ user, action: 'delete', entity: 'vendor', entityId: id, summary: `Menghapus vendor "${existing.nama}"` });
  return NextResponse.json({ ok: true });
}
