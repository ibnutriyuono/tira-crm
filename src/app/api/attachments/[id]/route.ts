import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { deleteObject, isS3Configured, presignGet } from '@/lib/s3';
import { emitCrmEvent } from '@/lib/socket';
import { docScopeWhere, docVisibleTo, prospectScopeWhere } from '@/lib/auth';
import { guard } from '@/lib/permissions-server';
import type { SafeUser } from '@/lib/types';

/**
 * Lampiran hanya boleh dibuka / dihapus oleh user yang dapat melihat dokumen
 * pemiliknya (cakupan role) dan memiliki hak modulnya (Kelola Role).
 */
async function attachmentDenied(user: SafeUser, a: { rfqId: string | null; fupaId: string | null; prospectId: string | null }, act: 'v' | 'd') {
  const doc = !!(a.rfqId || a.fupaId);
  const denied = await guard(user, doc ? 'rfq' : 'prospek', act);
  if (denied) return denied;
  const visible = doc
    ? (a.rfqId
        ? !!(await prisma.rfq.findFirst({ where: { id: a.rfqId, ...(await docScopeWhere(user)) }, select: { id: true } }))
        : !!(await prisma.fupa.findFirst({ where: { id: a.fupaId as string, ...(await docScopeWhere(user, { table: 'fupa' })) }, select: { id: true } }))) &&
      (await docVisibleTo(user, { rfqId: a.rfqId, fupaId: a.fupaId }))
    : !!a.prospectId && !!(await prisma.prospect.findFirst({ where: { id: a.prospectId, ...prospectScopeWhere(user) }, select: { id: true } }));
  return visible ? null : NextResponse.json({ error: 'Lampiran tidak ditemukan' }, { status: 404 });
}

/** Redirects to a short-lived presigned URL — the bucket itself stays private. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!isS3Configured()) return NextResponse.json({ error: 'Penyimpanan file belum dikonfigurasi.' }, { status: 503 });

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: 'Lampiran tidak ditemukan' }, { status: 404 });
  const deniedV = await attachmentDenied(user, attachment, 'v');
  if (deniedV) return deniedV;

  try {
    const url = await presignGet(attachment.key, attachment.name);
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: 'Gagal membuat tautan unduhan.' }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: 'Lampiran tidak ditemukan' }, { status: 404 });
  const deniedD = await attachmentDenied(user, attachment, 'd');
  if (deniedD) return deniedD;

  // Drop the row even if the object delete fails — a stray object is cheaper
  // than a row pointing at something the user believes is gone.
  try {
    await deleteObject(attachment.key);
  } catch {
    // ignored on purpose, see above
  }
  await prisma.attachment.delete({ where: { id } });

  emitCrmEvent('attachment:deleted', { id, rfqId: attachment.rfqId, fupaId: attachment.fupaId });
  await logActivity({
    user,
    action: 'delete',
    entity: attachment.rfqId ? 'rfq' : attachment.fupaId ? 'fupa' : 'prospect',
    entityId: (attachment.rfqId || attachment.fupaId || attachment.prospectId) as string,
    summary: `Menghapus lampiran "${attachment.name}"`,
  });
  return NextResponse.json({ ok: true });
}
