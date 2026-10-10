import { normalizeItemLines } from '@/lib/format';
import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, docScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { notify, purchasingUserIds } from '@/lib/notify';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const rfqs = await prisma.rfq.findMany({ where: await docScopeWhere(user), orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ rfqs });
}

/**
 * Nomor RFQ berikutnya dalam format RFQ-YYYY-NNNN, urut per tahun.
 *
 * Diambil dari nomor tertinggi yang sudah ada di tahun berjalan, bukan dari
 * jumlah baris — menghitung baris akan mengulang nomor yang sudah dipakai
 * begitu ada RFQ yang dibatalkan atau dihapus.
 *
 * Catatan: dua permintaan yang benar-benar bersamaan masih bisa menghasilkan
 * nomor yang sama. Untuk volume aplikasi ini praktis tidak terjadi; kalau
 * nanti perlu jaminan penuh, tambahkan unique index pada noRfq lalu ulangi
 * sekali saat bentrok.
 */
async function nextRfqNumber(): Promise<string> {
  const tahun = new Date().getFullYear();
  const prefix = `RFQ-${tahun}-`;
  const terakhir = await prisma.rfq.findFirst({
    where: { noRfq: { startsWith: prefix } },
    orderBy: { noRfq: 'desc' },
    select: { noRfq: true },
  });
  // noRfq is nullable in the schema; the startsWith filter guarantees a value
  // here, but the type doesn't know that.
  const urut = terakhir?.noRfq ? Number(terakhir.noRfq.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(urut + 1).padStart(4, '0')}`;
}

/** Kode error Prisma untuk pelanggaran unique constraint. */
const UNIQUE_VIOLATION = 'P2002';

async function createDenganNomorOtomatis(dataDasar: Record<string, unknown>, percobaan = 5) {
  for (let i = 0; i < percobaan; i++) {
    try {
      return await prisma.rfq.create({ data: { ...dataDasar, noRfq: await nextRfqNumber() } as never });
    } catch (err) {
      const kode = (err as { code?: string })?.code;
      if (kode !== UNIQUE_VIOLATION) throw err;
      // Nomor keburu dipakai proses lain; putaran berikutnya membaca ulang.
    }
  }
  return null;
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  // Nomor boleh dikosongkan — kalau kosong, dibuatkan otomatis saat create.
  const nomorManual = String(body?.noRfq || '').trim();
  const prospectId = body?.prospectId || null;
  // Denormalize the region from the source prospect so rm-scoped queries can
  // filter on the RFQ alone; fall back to the acting user's own region.
  const sourceProspect = prospectId ? await prisma.prospect.findUnique({ where: { id: prospectId }, select: { reg: true } }) : null;

  // Without a source prospect, derive the region from the branch so the row
  // never lands with a NULL reg (which would hide it from its own RM).
  const cabang = String(body?.cabang || '').trim().toUpperCase();
  let reg: number | null = sourceProspect?.reg ?? null;
  if (reg == null && cabang) reg = (await cabangRegMap())[cabang] ?? null;
  if (reg == null) reg = user.reg ?? null;

  const dataDasar = {
    tglRfq: body?.tglRfq || '',
    cabang,
    reg,
    customer: body?.customer || '',
    requestedBy: body?.requestedBy || user.name,
    prospectId,
    items: Array.isArray(body?.items) ? (normalizeItemLines(body.items) as unknown as Prisma.InputJsonValue) : [],
    catatan: String(body?.catatan || ''),
    status: body?.markSent ? 'Terkirim' : 'Draft',
    sentToPurchasingAt: body?.markSent ? new Date() : null,
  };

  let rfq;
  if (nomorManual) {
    // Nomor diketik sendiri: kalau sudah dipakai, itu kesalahan input yang
    // harus diberitahukan — bukan diam-diam diganti nomor lain.
    const bentrok = await prisma.rfq.findUnique({ where: { noRfq: nomorManual }, select: { id: true } });
    if (bentrok) {
      return NextResponse.json({ error: `No. RFQ "${nomorManual}" sudah dipakai. Gunakan nomor lain, atau kosongkan agar dibuatkan otomatis.` }, { status: 409 });
    }
    rfq = await prisma.rfq.create({ data: { ...dataDasar, noRfq: nomorManual } });
  } else {
    // Nomor otomatis: unique index bisa menolak kalau ada permintaan lain
    // menyerobot nomor yang sama di antara pembacaan dan penulisan. Ulangi
    // beberapa kali — tiap percobaan membaca ulang nomor tertinggi, jadi
    // percobaan kedua sudah memakai nomor sesudahnya.
    rfq = await createDenganNomorOtomatis(dataDasar);
    if (!rfq) {
      return NextResponse.json({ error: 'Gagal membuat nomor RFQ karena bentrok berulang. Coba simpan lagi.' }, { status: 503 });
    }
  }

  emitCrmEvent('rfq:created', rfq);
  await logActivity({
    user,
    action: 'create',
    entity: 'rfq',
    entityId: rfq.id,
    summary: `Membuat RFQ ${rfq.noRfq || '(tanpa nomor)'} untuk "${rfq.customer || '-'}" (${rfq.status})`,
  });
  if (rfq.status === 'Terkirim') {
    await notify({
      userIds: await purchasingUserIds(rfq.items),
      type: 'rfq_new',
      entity: 'rfq',
      entityId: rfq.id,
      title: 'RFQ baru masuk',
      message: `${rfq.noRfq || '(tanpa nomor)'} dari ${rfq.cabang || '-'} — ${rfq.customer || '-'}`,
    });
  }
  return NextResponse.json({ rfq }, { status: 201 });
}
