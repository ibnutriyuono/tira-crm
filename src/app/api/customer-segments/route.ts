import { NextResponse } from 'next/server';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/activity';
import { SEG_SUPPLIER, type SegmentDef } from '@/lib/customer-segments';
import { getSegmentTaxonomy, saveSegmentTaxonomy, userCanEditSegment } from '@/lib/customer-segments-server';

/** GET → { segments, canEdit } — daftar segmen & sub-segmen customer. */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return NextResponse.json({ segments: await getSegmentTaxonomy(), canEdit: await userCanEditSegment(user) });
}

/**
 * PUT { segments, renames?: { segmen: [from, to][], sub: [segmen, from, to][] } } (Admin).
 * Ganti nama ikut diterapkan ke customer yang sudah memakai segmen / sub-segmen itu
 * (termasuk sub-segmen Supplier yang menunjuk ke segmen yang diganti namanya).
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = requireAdmin(user);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const segments = await saveSegmentTaxonomy((body?.segments || []) as SegmentDef[]);
  const segRen = (Array.isArray(body?.renames?.segmen) ? body.renames.segmen : []) as [string, string][];
  const subRen = (Array.isArray(body?.renames?.sub) ? body.renames.sub : []) as [string, string, string][];
  let moved = 0;
  for (const [from, to] of segRen) {
    if (!from || !to || from === to) continue;
    moved += (await prisma.customer.updateMany({ where: { segmen: from }, data: { segmen: to } })).count;
    moved += (await prisma.customer.updateMany({ where: { segmen: SEG_SUPPLIER, subSegmen: from }, data: { subSegmen: to } })).count;
  }
  for (const [seg, from, to] of subRen) {
    if (!seg || !from || !to || from === to) continue;
    moved += (await prisma.customer.updateMany({ where: { segmen: seg, subSegmen: from }, data: { subSegmen: to } })).count;
  }
  await logActivity({ user, action: 'update', entity: 'customer', entityId: 'segments', summary: `Mengubah daftar segmen customer (${segments.length} segmen${moved ? `, ${moved} customer ikut diperbarui` : ''})` });
  return NextResponse.json({ segments, moved });
}
