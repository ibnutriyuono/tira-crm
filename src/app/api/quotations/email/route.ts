import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { quotePermAct } from '@/lib/roles';
import { assertProspectInScope } from '@/lib/prospect-access';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { logActivity } from '@/lib/activity';
import { quoteEmailHtml, quoteEmailText, type QuoteEmailSummary } from '@/lib/quotation-email';

const MAX_ATTACH_BYTES = 12 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Apakah server bisa mengirim email (dipakai layar untuk memilih kirim langsung / lewat aplikasi email). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return NextResponse.json({ configured: mailConfigured() });
}

const emails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/))
    .map((x) => String(x).trim())
    .filter(Boolean);
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

let logoCache: Buffer | null | undefined;
async function logo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = await readFile(path.join(process.cwd(), 'public', 'logo.png'));
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/** Kirim Surat Penawaran ke customer: email HTML + lampiran PDF (dan .docx bila dipilih). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', quotePermAct(user.role));
  if (denied) return denied;
  if (!mailConfigured()) return NextResponse.json({ error: 'Server email belum diatur.', code: 'NO_SMTP' }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });

  const prospectId = str(body.prospectId, 64);
  if (prospectId) {
    const scoped = await assertProspectInScope(user, prospectId);
    if (scoped.error) return scoped.error;
  }

  const to = emails(body.to);
  const cc = emails(body.cc);
  const bad = [...to, ...cc].find((e) => !validEmail(e));
  if (!to.length) return NextResponse.json({ error: 'Isi alamat email tujuan.' }, { status: 400 });
  if (bad) return NextResponse.json({ error: `Alamat email tidak valid: ${bad}` }, { status: 400 });
  if (to.length + cc.length > 15) return NextResponse.json({ error: 'Maksimal 15 penerima.' }, { status: 400 });

  const subject = str(body.subject, 200);
  const message = str(body.message, 6000);
  if (!subject) return NextResponse.json({ error: 'Subjek email wajib diisi.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Isi pesan email wajib diisi.' }, { status: 400 });

  const s = body.summary as Partial<QuoteEmailSummary> | undefined;
  if (!s || !s.nomor) return NextResponse.json({ error: 'Ringkasan penawaran tidak lengkap.' }, { status: 400 });
  const summary: QuoteEmailSummary = {
    lang: s.lang === 'en' ? 'en' : 'id',
    nomor: str(s.nomor, 80),
    tanggal: str(s.tanggal, 40),
    perihal: str(s.perihal, 200),
    kepada: str(s.kepada, 200),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 200).map((it) => ({ uraian: str(it?.uraian, 300), qty: Number(it?.qty) || 0, satuan: str(it?.satuan, 20) })),
    total: str(s.total, 40),
    ppnNote: str(s.ppnNote, 60),
    berlaku: str(s.berlaku, 160),
    signer: { nama: str(s.signer?.nama, 100) || user.name, jabatan: str(s.signer?.jabatan, 100), telp: str(s.signer?.telp, 60), email: str(s.signer?.email, 120) },
  };

  // Lampiran dari browser (PDF wajib, .docx opsional).
  const files: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
  let total = 0;
  for (const a of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 3)) {
    const ext = String(a?.filename || '').split('.').pop()?.toLowerCase() || '';
    if (!TYPES[ext]) continue;
    const content = Buffer.from(String(a?.content || ''), 'base64');
    total += content.length;
    if (!content.length) continue;
    if (total > MAX_ATTACH_BYTES) return NextResponse.json({ error: 'Lampiran terlalu besar (maks. 12 MB).' }, { status: 413 });
    const filename = String(a.filename).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120);
    files.push({ filename, content, contentType: TYPES[ext] });
  }
  if (!files.some((f) => f.contentType === TYPES.pdf)) return NextResponse.json({ error: 'Lampiran PDF penawaran tidak ada.' }, { status: 400 });

  const logoBuf = await logo();
  const input = { message, summary, attachments: files.map((f) => f.filename), logoSrc: logoBuf ? 'cid:tira-logo' : '' };
  const html = quoteEmailHtml(input);
  const text = quoteEmailText(input);
  if (logoBuf) files.push({ filename: 'logo.png', content: logoBuf, contentType: 'image/png', cid: 'tira-logo' });

  const replyTo = validEmail(summary.signer.email) ? summary.signer.email : user.email && validEmail(user.email) ? user.email : undefined;
  const res = await sendCustomerMail({ userId: user.id, kind: 'penawaran', senderName: summary.signer.nama, replyTo, to, cc, subject, html, text, attachments: files });
  if (!res.ok) return NextResponse.json({ error: `Email gagal dikirim: ${res.error}` }, { status: 502 });

  await logActivity({
    user,
    action: 'update',
    entity: 'prospect',
    entityId: prospectId || summary.nomor,
    summary: `Mengirim surat penawaran No. ${summary.nomor} via email ke ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}${summary.signer.nama && summary.signer.nama !== user.name ? ` atas nama ${summary.signer.nama}` : ''}`,
  });
  return NextResponse.json({ ok: true, to, cc });
}
