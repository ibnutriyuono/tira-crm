import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { canApproveVendor, canSeeVendors } from '@/lib/roles';
import { cleanVendorProfile } from '@/lib/vendor-profile';
import { notify, opsLeadIds } from '@/lib/notify';

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
      // Vendor baru dari Purchasing menunggu persetujuan GM Operation (Approved Vendor List).
      statusAvl: canApproveVendor(user.role) ? 'aktif' : 'evaluasi',
      statusAlasan: canApproveVendor(user.role) ? null : 'Vendor baru — menunggu persetujuan GM Operation',
      statusOleh: user.name,
      statusAt: new Date(),
    },
  });
  if (vendor.statusAvl === 'evaluasi') {
    await notify({ userIds: await opsLeadIds(), type: 'announcement', entity: 'announcement', entityId: vendor.id, title: `Vendor baru menunggu persetujuan: ${vendor.nama}`, message: `${user.name} menambahkan vendor ${vendor.nama}. Setujui (Aktif) atau blokir di Database Vendor.` });
  }

  emitCrmEvent('vendor:created', vendor);
  await logActivity({ user, action: 'create', entity: 'vendor', entityId: vendor.id, summary: `Menambah vendor "${vendor.nama}"` });
  return NextResponse.json({ vendor }, { status: 201 });
}
