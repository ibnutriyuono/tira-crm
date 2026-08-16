import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

interface ImportRow {
  reg?: number | string;
  cabang?: string;
  se?: string;
  customer?: string;
  phone?: string;
  tglPenawaran?: string;
  tglPO?: string;
  tglDelivery?: string;
  line?: string;
  uraian?: string;
  qty?: number;
  value?: number;
  kondisiStock?: string;
  keterangan?: string;
  status?: number;
  penawaranTerkirim?: boolean;
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
    if (mode === 'replace') await tx.prospect.deleteMany({});
    const rows2 = rows.map((r) => {
      const qty = Number(r.qty) || 0;
      const value = Number(r.value) || 0;
      return tx.prospect.create({
        data: {
          reg: r.reg !== '' && r.reg != null ? Number(r.reg) : null,
          cabang: r.cabang || '',
          se: r.se || '',
          customer: r.customer || '',
          phone: r.phone || '',
          tglPenawaran: r.tglPenawaran || null,
          tglPO: r.tglPO || null,
          tglDelivery: r.tglDelivery || null,
          line: r.line || '',
          uraian: r.uraian || '',
          qty,
          value,
          materials: [{ line: r.line || '', uraian: r.uraian || '', qty, harga: qty > 0 ? Math.round(value / qty) : value }],
          kondisiStock: r.kondisiStock || '',
          keterangan: r.keterangan || '',
          status: Number(r.status) || 0,
          penawaranTerkirim: !!r.penawaranTerkirim,
        },
      });
    });
    return Promise.all(rows2);
  });

  emitCrmEvent('prospect:bulk-imported', { mode, count: created.length });
  await logActivity({
    user,
    action: 'import',
    entity: 'prospect',
    summary: `Import Excel ${created.length} prospek (mode: ${mode === 'replace' ? 'ganti semua data' : 'tambahkan'})`,
  });
  return NextResponse.json({ count: created.length });
}
