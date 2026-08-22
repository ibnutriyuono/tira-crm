import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

interface ImportRow {
  nama?: string;
  pic?: string;
  wa?: string;
  email?: string;
  kategori?: string;
  alamat?: string;
  catatan?: string;
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengimport vendor.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rows: ImportRow[] = Array.isArray(body?.records) ? body.records : [];
  const mode = body?.mode === 'replace' ? 'replace' : 'append';
  // A vendor row with no name is unusable — drop it rather than creating blanks.
  const clean = rows.filter((r) => String(r.nama || '').trim());
  if (clean.length === 0) return NextResponse.json({ error: 'Tidak ada data vendor untuk diimport' }, { status: 400 });

  const created = await prisma.$transaction(async (tx) => {
    if (mode === 'replace') await tx.vendor.deleteMany({});
    return Promise.all(
      clean.map((r) =>
        tx.vendor.create({
          data: {
            nama: String(r.nama || '').trim(),
            pic: String(r.pic || '').trim(),
            wa: String(r.wa || '').trim(),
            email: String(r.email || '').trim(),
            kategori: String(r.kategori || '').trim(),
            alamat: String(r.alamat || '').trim(),
            catatan: String(r.catatan || '').trim(),
          },
        }),
      ),
    );
  });

  emitCrmEvent('vendor:bulk-imported', { mode, count: created.length });
  await logActivity({
    user,
    action: 'import',
    entity: 'vendor',
    summary: `Import Excel ${created.length} vendor (mode: ${mode === 'replace' ? 'ganti semua data' : 'tambahkan'})`,
  });
  return NextResponse.json({ count: created.length, skipped: rows.length - clean.length });
}
