import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { docVisibleTo, prospectScopeWhere } from '@/lib/auth';
import type { SafeUser } from '@/lib/types';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { buildKey, isS3Configured, putObject } from '@/lib/s3';
import { emitCrmEvent } from '@/lib/socket';

// Bytes go straight to object storage, so this is generous compared with the
// prototype's 1.5MB base64 ceiling — but still bounded, since the upload is
// buffered in the Node process before being forwarded. Shared with the form
// labels so what the user is told matches what is enforced.
const MAX_BYTES = ATTACHMENT_MAX_BYTES;

async function prospectVisible(user: SafeUser, id: string): Promise<boolean> {
  return !!(await prisma.prospect.findFirst({ where: { id, ...prospectScopeWhere(user) }, select: { id: true } }));
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const { searchParams } = new URL(req.url);
  const rfqId = searchParams.get('rfqId');
  const fupaId = searchParams.get('fupaId');
  const prospectId = searchParams.get('prospectId');
  if (!rfqId && !fupaId && !prospectId) return NextResponse.json({ error: 'rfqId, fupaId atau prospectId wajib diisi.' }, { status: 400 });

  if (prospectId && !rfqId && !fupaId) {
    if (!(await prospectVisible(user, prospectId))) return NextResponse.json({ attachments: [] });
    const attachments = await prisma.attachment.findMany({ where: { prospectId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ attachments });
  }

  if (!(await docVisibleTo(user, { rfqId, fupaId }))) return NextResponse.json({ attachments: [] });
  const attachments = await prisma.attachment.findMany({
    where: rfqId ? { rfqId } : { fupaId },
    orderBy: { createdAt: 'asc' },
  });
  // withProspect: also the drawings attached to the source prospect (Line 05),
  // read-only here. Visible to whoever may see the document itself.
  if (searchParams.get('withProspect')) {
    const doc = rfqId
      ? await prisma.rfq.findUnique({ where: { id: rfqId }, select: { prospectId: true } })
      : await prisma.fupa.findUnique({ where: { id: fupaId as string }, select: { prospectId: true } });
    if (doc?.prospectId) {
      const fromProspect = await prisma.attachment.findMany({ where: { prospectId: doc.prospectId }, orderBy: { createdAt: 'asc' } });
      return NextResponse.json({ attachments: [...fromProspect.map((a: object) => ({ ...a, fromProspect: true })), ...attachments] });
    }
  }
  return NextResponse.json({ attachments });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!isS3Configured()) {
    return NextResponse.json({ error: 'Penyimpanan file belum dikonfigurasi. Hubungi admin.' }, { status: 503 });
  }

  // Check the declared length first: an oversized body makes req.formData()
  // throw, which would otherwise surface as a confusing "file not found".
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: `File melebihi batas ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: `Gagal membaca file — kemungkinan melebihi batas ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` }, { status: 413 });
  }

  const file = form.get('file');
  const rfqId = (form.get('rfqId') as string) || null;
  const fupaId = (form.get('fupaId') as string) || null;
  const prospectId = !rfqId && !fupaId ? (form.get('prospectId') as string) || null : null;

  if (!(file instanceof File)) return NextResponse.json({ error: 'File tidak ditemukan.' }, { status: 400 });
  if (!rfqId && !fupaId && !prospectId) return NextResponse.json({ error: 'rfqId, fupaId atau prospectId wajib diisi.' }, { status: 400 });
  if (prospectId && !(await prospectVisible(user, prospectId))) return NextResponse.json({ error: 'Prospek tidak ditemukan.' }, { status: 404 });
  if (!prospectId && !(await docVisibleTo(user, { rfqId, fupaId }))) return NextResponse.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File "${file.name}" melebihi batas ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` }, { status: 413 });
  }

  const entity = rfqId ? 'rfq' : fupaId ? 'fupa' : 'prospect';
  const parentId = (rfqId || fupaId || prospectId) as string;
  const key = buildKey(entity, parentId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, file.type);
  } catch {
    return NextResponse.json({ error: 'Gagal mengunggah file ke penyimpanan. Coba lagi.' }, { status: 502 });
  }

  const attachment = await prisma.attachment.create({
    data: { rfqId, fupaId, prospectId, name: file.name, type: file.type || null, size: file.size, key, uploadedBy: user.name },
  });

  emitCrmEvent('attachment:created', attachment);
  await logActivity({
    user,
    action: 'create',
    entity,
    entityId: parentId,
    summary: `Melampirkan file "${file.name}" pada ${entity === 'rfq' ? 'RFQ' : entity === 'fupa' ? 'FUP A' : 'prospek (gambar Line 05)'}`,
  });
  return NextResponse.json({ attachment }, { status: 201 });
}
