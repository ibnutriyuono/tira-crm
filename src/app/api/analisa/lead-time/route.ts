import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prospectScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import type { LtEvent, LtJanji } from '@/lib/lead-time';

/**
 * Analisa Eksekutif > Lead Time (dan basis "terkirim" tab Product): event PO /
 * kirim per item (Status Item) untuk prospek PO / DO yang terlihat pemanggil,
 * plus janji delivery Purchasing dari RFQ yang terhubung ke prospek tersebut.
 * Hanya grade / ukuran / waktu delivery yang dikirim — tanpa harga, HPP atau
 * vendor.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'analisa', 'v');
  if (denied) return denied;

  const visible = (await prisma.prospect.findMany({ where: { AND: [prospectScopeWhere(user), { status: { in: [4, 5] } }] }, select: { id: true } })) as { id: string }[];
  if (!visible.length) return NextResponse.json({ events: [], janji: [] });
  const ids = visible.map((p) => p.id);

  const [evRows, rfqRows] = await Promise.all([
    prisma.prospectItemEvent.findMany({
      where: { prospectId: { in: ids }, type: { in: ['po', 'kirim'] } },
      select: { prospectId: true, type: true, tgl: true, docNo: true, items: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.rfq.findMany({ where: { prospectId: { in: ids } }, select: { prospectId: true, noRfq: true, items: true } }),
  ]);

  const events: LtEvent[] = (evRows as { prospectId: string; type: string; tgl: string | null; docNo: string | null; items: unknown; createdAt: Date }[]).map((e) => ({
    prospectId: e.prospectId,
    type: e.type === 'po' ? 'po' : 'kirim',
    tgl: e.tgl || e.createdAt.toISOString().slice(0, 10),
    docNo: e.docNo || '',
    items: (Array.isArray(e.items) ? (e.items as { itemId?: unknown; qty?: unknown }[]) : [])
      .map((l) => ({ itemId: String(l?.itemId || ''), qty: Number(l?.qty) || 0 }))
      .filter((l) => l.itemId && l.qty > 0),
  }));

  const janji: LtJanji[] = [];
  (rfqRows as { prospectId: string | null; noRfq: string | null; items: unknown }[]).forEach((r) => {
    if (!r.prospectId || !Array.isArray(r.items)) return;
    (r.items as Record<string, unknown>[]).forEach((it) => {
      const text = String(it?.deliveryTime || '').trim();
      if (!text || it?.noQuote) return;
      janji.push({
        prospectId: r.prospectId as string,
        noRfq: r.noRfq || '',
        grade: String(it.grade || ''),
        material: String(it.material || ''),
        thick: Number(String(it.thick ?? '').replace(',', '.')) || 0,
        dia: Number(String(it.dia ?? '').replace(',', '.')) || 0,
        text,
      });
    });
  });

  return NextResponse.json({ events, janji });
}
