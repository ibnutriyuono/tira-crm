import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { can } from '@/lib/permissions';
import { effectivePerms, guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { cleanSppDoc } from '@/lib/spp-doc';
import { buildSppFile, loadSpp, SPP_TYPES, type SppFormat } from './shared';

/**
 * Form SPP (Surat Penerimaan Pesanan) FUP A.
 *   GET  ?format=json        -> { doc, saved, auto } isi form (tersimpan atau otomatis dari CRM)
 *   GET  ?format=xlsx|docx   -> file dari isi tersimpan / otomatis
 *   PUT  { doc }             -> simpan isi form (edit & tambahan manual)
 *   POST { doc, format }     -> file dari isi yang sedang diedit (ikut disimpan bila boleh ubah)
 */
const fmtOf = (v: unknown): SppFormat => (v === 'docx' ? 'docx' : 'xlsx');

function fileResponse(f: { filename: string; content: Buffer; contentType: string }) {
  return new NextResponse(new Uint8Array(f.content), {
    headers: { 'Content-Type': f.contentType, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rfq', 'v');
  if (denied) return denied;
  const { id } = await params;
  const ctx = await loadSpp(user, id);
  if ('error' in ctx) return ctx.error;
  const format = new URL(req.url).searchParams.get('format');
  if (format === 'json') return NextResponse.json({ doc: ctx.saved || ctx.auto, auto: ctx.auto, saved: !!ctx.saved, canEdit: can(await effectivePerms(user), 'rfq', 'e') });
  const f = await buildSppFile(ctx.saved || ctx.auto, fmtOf(format));
  await logActivity({ user, action: 'export', entity: 'fupa', entityId: id, summary: `Mengunduh SPP FUP A ${ctx.fupa.noFupa} (${f.filename.endsWith('docx') ? 'Word' : 'Excel'})` });
  return fileResponse(f);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rfq', 'e');
  if (denied) return denied;
  const { id } = await params;
  const ctx = await loadSpp(user, id);
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const doc = cleanSppDoc(body?.doc, ctx.saved || ctx.auto);
  doc.noFupa = ctx.auto.noFupa;
  await prisma.fupa.update({ where: { id }, data: { spp: doc as unknown as Prisma.InputJsonValue } });
  await logActivity({ user, action: 'update', entity: 'fupa', entityId: id, summary: `Menyimpan Form SPP FUP A ${ctx.fupa.noFupa}` });
  return NextResponse.json({ doc });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rfq', 'v');
  if (denied) return denied;
  const { id } = await params;
  const ctx = await loadSpp(user, id);
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const doc = cleanSppDoc(body?.doc, ctx.saved || ctx.auto);
  doc.noFupa = ctx.auto.noFupa;
  if (can(await effectivePerms(user), 'rfq', 'e')) await prisma.fupa.update({ where: { id }, data: { spp: doc as unknown as Prisma.InputJsonValue } });
  const format = fmtOf(body?.format);
  if (!SPP_TYPES[format]) return NextResponse.json({ error: 'Format tidak dikenal' }, { status: 400 });
  const f = await buildSppFile(doc, format);
  await logActivity({ user, action: 'export', entity: 'fupa', entityId: id, summary: `Mengunduh SPP FUP A ${ctx.fupa.noFupa} (${format === 'docx' ? 'Word' : 'Excel'})` });
  return fileResponse(f);
}
