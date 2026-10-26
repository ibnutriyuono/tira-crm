import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { RfqItem } from '@/lib/types';
import { vrLines } from '@/lib/vendor-request';
import { buildVrPdf, buildVrXlsx, vrToken } from '@/lib/vendor-request-server';
import { timingSafeEqual } from 'crypto';

/**
 * Tautan unduh daftar item untuk vendor via WhatsApp (tanpa login).
 * Hanya berisi item & ukuran — tanpa customer, harga atau data internal.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const t = String(searchParams.get('t') || '');
  const f = searchParams.get('f') === 'xlsx' ? 'xlsx' : 'pdf';
  const expect = vrToken(id);
  if (t.length !== expect.length || !timingSafeEqual(Buffer.from(t), Buffer.from(expect))) return new NextResponse('Tautan tidak valid', { status: 404 });
  const q = await prisma.quotation.findUnique({ where: { id }, include: { vendor: { select: { nama: true } } } });
  if (!q || (!q.rfqId && !q.fupaId)) return new NextResponse('Tautan tidak valid', { status: 404 });
  const doc = q.rfqId ? await prisma.rfq.findUnique({ where: { id: q.rfqId } }) : await prisma.fupa.findUnique({ where: { id: q.fupaId as string } });
  if (!doc) return new NextResponse('Tautan tidak valid', { status: 404 });
  const no = ('noRfq' in doc ? doc.noRfq : (doc as { noFupa: string | null }).noFupa) || 'RFQ';
  const lines = vrLines((doc.items as unknown as RfqItem[]) || []);
  const meta = { docNo: no, tenggat: q.tenggat || '', lokasi: (q.catatan || '').replace(/^Lokasi kirim:\s*/, ''), sender: q.requestedBy || 'Purchasing' };
  const safe = no.replace(/[^\w-]+/g, '_');
  const buf = f === 'pdf' ? await buildVrPdf(lines, meta) : await buildVrXlsx(lines, meta);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': f === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `inline; filename="RFQ_Vendor_${safe}.${f}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
