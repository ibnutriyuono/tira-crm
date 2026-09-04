import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
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

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const { searchParams } = new URL(req.url);
  const rfqId = searchParams.get('rfqId');
  const fupaId = searchParams.get('fupaId');
  if (!rfqId && !fupaId) return NextResponse.json({ error: 'rfqId atau fupaId wajib diisi.' }, { status: 400 });

  const attachments = await prisma.attachment.findMany({
    where: rfqId ? { rfqId } : { fupaId },
    orderBy: { createdAt: 'asc' },
  });
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

  if (!(file instanceof File)) return NextResponse.json({ error: 'File tidak ditemukan.' }, { status: 400 });
  if (!rfqId && !fupaId) return NextResponse.json({ error: 'rfqId atau fupaId wajib diisi.' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File "${file.name}" melebihi batas ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` }, { status: 413 });
  }

  const entity = rfqId ? 'rfq' : 'fupa';
  const key = buildKey(entity, (rfqId || fupaId) as string, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, file.type);
  } catch {
    return NextResponse.json({ error: 'Gagal mengunggah file ke penyimpanan. Coba lagi.' }, { status: 502 });
  }

  const attachment = await prisma.attachment.create({
    data: { rfqId, fupaId, name: file.name, type: file.type || null, size: file.size, key, uploadedBy: user.name },
  });

  emitCrmEvent('attachment:created', attachment);
  await logActivity({
    user,
    action: 'create',
    entity: entity === 'rfq' ? 'rfq' : 'fupa',
    entityId: (rfqId || fupaId) as string,
    summary: `Melampirkan file "${file.name}" pada ${entity === 'rfq' ? 'RFQ' : 'FUP A'}`,
  });
  return NextResponse.json({ attachment }, { status: 201 });
}
