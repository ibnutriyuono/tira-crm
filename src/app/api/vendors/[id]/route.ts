import { NextResponse } from 'next/server';
import { diffFields, logActivity, VENDOR_FIELD_LABELS } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { cleanVendorProfile, AVL_META } from '@/lib/vendor-profile';
import { notify, opsLeadIds } from '@/lib/notify';
import { canApproveVendor } from '@/lib/roles';

/**
 * Approved Vendor List. { action: 'avl', status: aktif|evaluasi|diblokir, alasan }
 *  - Purchasing: menandai "Dalam evaluasi" / mengusulkan aktif atau blokir (GM Operation diberi tahu);
 *  - GM Operation / VP / Admin: menetapkan Aktif atau Diblokir (alasan wajib untuk blokir).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action !== 'avl') return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  const v = await prisma.vendor.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: 'Vendor tidak ditemukan' }, { status: 404 });
  const status = String(body.status || '');
  const alasan = String(body.alasan || '').trim().slice(0, 300);
  const boss = canApproveVendor(user.role);
  if (!(status in AVL_META)) return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
  if (!boss && !canEditPurchasing(user)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  if (status === 'diblokir' && alasan.length < 5) return NextResponse.json({ error: 'Alasan blokir wajib diisi.' }, { status: 400 });
  // Purchasing tidak bisa langsung mengaktifkan / memblokir: jadi usulan ke GM Operation.
  const finalStatus = boss ? status : 'evaluasi';
  const note = boss ? alasan || null : `${status === 'aktif' ? 'Usul aktif' : status === 'diblokir' ? 'Usul blokir' : 'Evaluasi'}: ${alasan || '-'}`;
  const vendor = await prisma.vendor.update({ where: { id }, data: { statusAvl: finalStatus, statusAlasan: note, statusOleh: user.name, statusAt: new Date() } });
  emitCrmEvent('vendor:updated', vendor);
  if (!boss) {
    await notify({ userIds: await opsLeadIds(), type: 'announcement', entity: 'announcement', entityId: vendor.id, title: `Approved Vendor List: ${vendor.nama}`, message: `${user.name} — ${note}. Tetapkan status di Database Vendor.` });
  }
  await logActivity({ user, action: 'status_change', entity: 'vendor', entityId: id, summary: `Status vendor "${v.nama}": ${AVL_META[finalStatus as keyof typeof AVL_META].label}${note ? ` — ${note}` : ''}` });
  return NextResponse.json({ vendor });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'purch', 'e');
  if (denied) return denied;
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
      ...cleanVendorProfile(body || {}),
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
  const denied = await guard(user, 'purch', 'd');
  if (denied) return denied;
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
