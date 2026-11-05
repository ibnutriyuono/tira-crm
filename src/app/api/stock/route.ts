import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { getOpsRules } from '@/lib/ops-escalation';
import { prisma } from '@/lib/prisma';
import { canSeeHpp } from '@/lib/roles';
import { emitCrmEvent } from '@/lib/socket';
import { saranHarga, type StockMeta, type StockRow } from '@/lib/stock';
import { parseStockWorkbook } from '@/lib/stock-import';

/**
 * Stok gudang (snapshot Sage, upload manual Admin).
 *   GET               → { meta, marginPct, items: StockRow[] }  — barang baja yang terbaca grade-nya,
 *                        dengan saran harga jual minimal; TANPA HPP.
 *   GET ?all=1        → Admin / role ber-HPP: semua baris + HPP per satuan.
 *   POST (form-data: file) → Admin: ganti seluruh isi stok dengan file Excel baru.
 */

const META_KEY = 'stockMeta';
const MAX_BYTES = 15 * 1024 * 1024;

async function readMeta(): Promise<StockMeta> {
  const row = await prisma.setting.findUnique({ where: { key: META_KEY } });
  const v = (row?.value || {}) as Partial<StockMeta>;
  return { asOf: v.asOf ?? null, fileName: v.fileName ?? null, uploadedAt: v.uploadedAt ?? null, uploadedBy: v.uploadedBy ?? null, count: v.count ?? 0 };
}

type DbStock = Awaited<ReturnType<typeof prisma.stockItem.findMany>>[number];

function view(r: DbStock, marginPct: number): StockRow {
  return {
    id: r.id,
    itemNo: r.itemNo,
    line: r.line,
    description: r.description,
    unit: r.unit,
    qty: r.qty,
    fsv: r.fsv,
    ageDays: r.ageDays,
    locations: (r.locations || {}) as Record<string, number>,
    grade: r.grade,
    gradeKey: r.gradeKey,
    variant: r.variant,
    bentuk: r.bentuk,
    dim: (r.dim || {}) as StockRow['dim'],
    saran: saranHarga(r.hpp, marginPct),
  };
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const all = new URL(req.url).searchParams.get('all') === '1';
  const [meta, rules] = await Promise.all([readMeta(), getOpsRules()]);
  const marginPct = rules.stockMarginPct;
  if (all) {
    if (!canSeeHpp(user.role)) return NextResponse.json({ error: 'Tidak berhak melihat HPP stok.' }, { status: 403 });
    const rows = await prisma.stockItem.findMany({ orderBy: [{ line: 'asc' }, { description: 'asc' }] });
    return NextResponse.json({ meta, marginPct, items: rows.map((r) => ({ ...view(r, marginPct), hpp: r.hpp, size: r.size })) });
  }
  const rows = await prisma.stockItem.findMany({ where: { gradeKey: { not: null }, qty: { gt: 0 } } });
  return NextResponse.json({ meta, marginPct, items: rows.map((r) => view(r, marginPct)) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'admin') return NextResponse.json({ error: 'Hanya Admin yang dapat mengunggah data stok.' }, { status: 403 });
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return NextResponse.json({ error: 'File terlalu besar (maks. 15 MB).' }, { status: 413 });
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: 'Unggahan tidak terbaca.' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'Pilih file Excel stok.' }, { status: 400 });
  if (!/\.xlsx?$/i.test(file.name)) return NextResponse.json({ error: 'File harus Excel (.xlsx / .xls).' }, { status: 400 });

  let parsed;
  try {
    parsed = await parseStockWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'File tidak terbaca.' }, { status: 400 });
  }
  if (!parsed.rows.length) return NextResponse.json({ error: 'Tidak ada baris stok dengan qty > 0 di file ini.' }, { status: 400 });

  const meta: StockMeta = { asOf: parsed.asOf, fileName: file.name, uploadedAt: new Date().toISOString(), uploadedBy: user.name, count: parsed.rows.length };
  await prisma.$transaction(
    async (tx) => {
      await tx.stockItem.deleteMany({});
      for (let i = 0; i < parsed.rows.length; i += 500) {
        await tx.stockItem.createMany({
          data: parsed.rows.slice(i, i + 500).map((r) => ({ ...r, locations: r.locations as Prisma.InputJsonValue, dim: r.dim as Prisma.InputJsonValue })),
        });
      }
      await tx.setting.upsert({ where: { key: META_KEY }, create: { key: META_KEY, value: meta as unknown as Prisma.InputJsonValue }, update: { value: meta as unknown as Prisma.InputJsonValue } });
    },
    { timeout: 60000 },
  );
  await logActivity({
    user,
    action: 'update',
    entity: 'setting',
    entityId: META_KEY,
    summary: `Mengunggah data stok gudang ${file.name} (${parsed.rows.length} item${parsed.asOf ? `, per ${parsed.asOf}` : ''})`,
  });
  emitCrmEvent('stock:updated', {});
  return NextResponse.json({
    meta,
    summary: {
      rows: parsed.rows.length,
      matchable: parsed.rows.filter((r) => r.gradeKey).length,
      noHpp: parsed.noHpp,
      locations: parsed.locations,
      sheet: parsed.sheet,
    },
  });
}
