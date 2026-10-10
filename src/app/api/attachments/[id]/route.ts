import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { deleteObject, isS3Configured, presignGet } from '@/lib/s3';
import { emitCrmEvent } from '@/lib/socket';

/** Redirects to a short-lived presigned URL — the bucket itself stays private. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!isS3Configured()) return NextResponse.json({ error: 'Penyimpanan file belum dikonfigurasi.' }, { status: 503 });

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: 'Lampiran tidak ditemukan' }, { status: 404 });

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
