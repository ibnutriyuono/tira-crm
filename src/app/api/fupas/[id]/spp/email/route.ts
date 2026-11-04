import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { can } from '@/lib/permissions';
import { effectivePerms, guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { cleanSppDoc, sppTotals } from '@/lib/spp-doc';
import { buildSppFile, loadSpp, type SppFormat } from '../shared';

const emails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kirim Form SPP FUP A lewat email server, file Excel dan/atau Word terlampir. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rfq', 'v');
  if (denied) return denied;
  if (!mailConfigured()) return NextResponse.json({ error: 'Server email belum diatur — unduh file lalu kirim lewat aplikasi email.', code: 'NO_SMTP' }, { status: 503 });
  const { id } = await params;
  const ctx = await loadSpp(user, id);
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });

  const to = emails(body.to);
  const cc = emails(body.cc);
  const bad = [...to, ...cc].find((e) => !validEmail(e));
  if (!to.length) return NextResponse.json({ error: 'Isi alamat email tujuan.' }, { status: 400 });
  if (bad) return NextResponse.json({ error: `Alamat email tidak valid: ${bad}` }, { status: 400 });
  if (to.length + cc.length > 15) return NextResponse.json({ error: 'Maksimal 15 penerima.' }, { status: 400 });
  const subject = String(body.subject || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 6000);
  if (!subject) return NextResponse.json({ error: 'Subjek email wajib diisi.' }, { status: 400 });
  const formats: SppFormat[] = (Array.isArray(body.formats) ? (body.formats as unknown[]) : ['xlsx']).filter((f): f is SppFormat => f === 'xlsx' || f === 'docx');
  if (!formats.length) return NextResponse.json({ error: 'Pilih minimal satu lampiran (Excel / Word).' }, { status: 400 });

  const doc = cleanSppDoc(body.doc, ctx.saved || ctx.auto);
  doc.noFupa = ctx.auto.noFupa;
  if (can(await effectivePerms(user), 'rfq', 'e')) await prisma.fupa.update({ where: { id }, data: { spp: doc as unknown as Prisma.InputJsonValue } });
  const files = await Promise.all(Array.from(new Set(formats)).map((f) => buildSppFile(doc, f)));

  const t = sppTotals(doc);
  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
  const rows: [string, string][] = [
    ['No. FUP A', doc.noFupa],
    ['Customer', doc.customer],
    ['Cabang', doc.cabang],
    ['No. PO', doc.noPo || '-'],
    ['Jumlah item', String(doc.lines.filter((l) => l.keterangan.trim()).length)],
    ['Grand total', rp(t.grand)],
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">${esc(message || 'Terlampir Form SPP FUP A.').replace(/\n/g, '<br>')}
<table style="margin-top:14px;border-collapse:collapse;font-size:13px">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#6b7280">${esc(k)}</td><td style="padding:3px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin-top:14px;color:#6b7280;font-size:12px">Lampiran: ${files.map((f) => esc(f.filename)).join(', ')}</p></div>`;
  const text = `${message || 'Terlampir Form SPP FUP A.'}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nLampiran: ${files.map((f) => f.filename).join(', ')}`;
  const replyTo = user.email && validEmail(user.email) ? user.email : undefined;
  const res = await sendCustomerMail({ userId: user.id, kind: 'spp', senderName: user.name, replyTo, to, cc, subject, html, text, attachments: files });
  if (!res.ok) return NextResponse.json({ error: `Email gagal dikirim: ${res.error}` }, { status: 502 });

  await logActivity({ user, action: 'update', entity: 'fupa', entityId: id, summary: `Mengirim Form SPP FUP A ${doc.noFupa} via email ke ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''} — ${files.map((f) => f.filename).join(', ')}` });
  return NextResponse.json({ ok: true, to, cc });
}
