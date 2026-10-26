import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { canSeeVendors } from '@/lib/roles';
import { cleanVendorProfile } from '@/lib/vendor-profile';
import { notify } from '@/lib/notify';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'purch', 'v');
  if (denied) return denied;
  // Purchasing data: Sales-side roles get an empty list (lib/roles.ts#canSeeVendors).
  if (!canSeeVendors(user.role)) return NextResponse.json({ vendors: [] });
  const vendors = await prisma.vendor.findMany({ orderBy: { nama: 'asc' } });
  return NextResponse.json({ vendors });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'purch', 'e');
  if (denied) return denied;
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
      ...cleanVendorProfile(body || {}),
      // Vendor baru dari Purchasing menunggu persetujuan GM (Approved Vendor List).
      statusAvl: user.role === 'gm' || user.role === 'admin' ? 'aktif' : 'evaluasi',
      statusAlasan: user.role === 'gm' || user.role === 'admin' ? null : 'Vendor baru — menunggu persetujuan GM',
      statusOleh: user.name,
      statusAt: new Date(),
    },
  });
  if (vendor.statusAvl === 'evaluasi') {
    const gms = await prisma.user.findMany({ where: { role: 'gm' }, select: { id: true } });
    await notify({ userIds: gms.map((g) => g.id), type: 'announcement', entity: 'announcement', entityId: vendor.id, title: `Vendor baru menunggu persetujuan: ${vendor.nama}`, message: `${user.name} menambahkan vendor ${vendor.nama}. Setujui (Aktif) atau blokir di Database Vendor.` });
  }

  emitCrmEvent('vendor:created', vendor);
  await logActivity({ user, action: 'create', entity: 'vendor', entityId: vendor.id, summary: `Menambah vendor "${vendor.nama}"` });
  return NextResponse.json({ vendor }, { status: 201 });
}
