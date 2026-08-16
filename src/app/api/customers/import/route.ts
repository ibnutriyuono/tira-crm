import { NextResponse } from 'next/server';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

interface ImportRow {
  name?: string;
  cabang?: string;
  pic?: string;
  phone?: string;
  email?: string;
  address?: string;
  catatan?: string;
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const body = await req.json().catch(() => null);
  const rows: ImportRow[] = Array.isArray(body?.records) ? body.records : [];
  const mode = body?.mode === 'replace' ? 'replace' : 'append';
  if (rows.length === 0) return NextResponse.json({ error: 'Tidak ada data untuk diimport' }, { status: 400 });

  const created = await prisma.$transaction(async (tx) => {
    if (mode === 'replace') await tx.customer.deleteMany({});
    return Promise.all(
      rows.map((r) =>
        tx.customer.create({
          data: {
            name: r.name || '',
            cabang: r.cabang || '',
            pic: r.pic || '',
            phone: r.phone || '',
            email: r.email || '',
            address: r.address || '',
            catatan: r.catatan || '',
          },
        }),
      ),
    );
  });

  emitCrmEvent('customer:bulk-imported', { mode, count: created.length });
  return NextResponse.json({ count: created.length });
}
