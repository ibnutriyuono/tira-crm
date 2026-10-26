import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import {
  MAIL_ATTACH_TYPES,
  MAIL_MAX_ATTACH_BYTES,
  MAIL_MAX_RECIPIENTS,
  canComposeMail,
  composeEmailHtml,
  composeEmailText,
  type ComposeMode,
} from '@/lib/compose-email';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/**
 * Menu "Kirim Email" (Admin & GM).
 *   POST { mode: 'internal', preview?: true, internal: { target, roles, cabangs, userIds, inApp }, subject, message, attachments }
 *     → pengumuman ke user CRM; tiap user menerima email sendiri (tidak saling
 *       melihat alamat), dan bila inApp juga masuk tab Notifikasi.
 *       preview: hanya menghitung penerima (dengan / tanpa email).
 *   POST { mode: 'customer', customer: { recipients: [{ customerId, emails[] }], cc[], ccSelf }, subject, message, attachments }
 *     → satu email per customer ke PIC yang dipilih; balasan ke pengirim.
 */

const JABATAN: Record<string, string> = { gm: 'General Manager', admin: 'Administrator CRM' };
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

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

async function internalRecipients(me: string, b: Record<string, unknown>) {
  const target = String(b.target || 'all');
  const where: Prisma.UserWhereInput = { id: { not: me } };
  if (target === 'roles') where.role = { in: list(b.roles) as never[] };
  else if (target === 'cabang') where.cabang = { in: list(b.cabangs), mode: 'insensitive' };
  else if (target === 'users') where.id = { in: list(b.userIds).filter((id) => id !== me) };
  else if (target !== 'all') return [];
  if ((target === 'roles' && !list(b.roles).length) || (target === 'cabang' && !list(b.cabangs).length) || (target === 'users' && !list(b.userIds).length)) return [];
  return prisma.user.findMany({ where, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canComposeMail(user.role)) return NextResponse.json({ error: 'Kirim Email hanya untuk Admin dan GM.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
  const mode: ComposeMode = body.mode === 'customer' ? 'customer' : 'internal';

  // Hitung penerima pengumuman tanpa mengirim.
  if (mode === 'internal' && body.preview) {
    const users = await internalRecipients(user.id, body.internal || {});
    const withEmail = users.filter((u) => u.email && validEmail(u.email)).length;
    return NextResponse.json({ total: users.length, withEmail, noEmail: users.length - withEmail, names: users.slice(0, 8).map((u) => u.name) });
  }

  const subject = str(body.subject, 200);
  const message = str(body.message, 10000);
  if (!subject) return NextResponse.json({ error: 'Subjek wajib diisi.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Isi pesan wajib diisi.' }, { status: 400 });

  // Lampiran dari browser (base64).
  const files: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
  let bytes = 0;
  for (const a of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 8)) {
    const ext = String(a?.filename || '').split('.').pop()?.toLowerCase() || '';
    if (!MAIL_ATTACH_TYPES[ext]) return NextResponse.json({ error: `Jenis lampiran tidak didukung: ${a?.filename || ''}` }, { status: 400 });
    const content = Buffer.from(String(a?.content || ''), 'base64');
    bytes += content.length;
    if (bytes > MAIL_MAX_ATTACH_BYTES) return NextResponse.json({ error: 'Lampiran terlalu besar (maks. 10 MB total).' }, { status: 413 });
    if (content.length) files.push({ filename: String(a.filename).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120), content, contentType: MAIL_ATTACH_TYPES[ext] });
  }

  const inAppOnly = mode === 'internal' && !!body.internal?.inApp && !mailConfigured();
  if (!mailConfigured() && !inAppOnly) return NextResponse.json({ error: 'Server email belum diatur.', code: 'NO_SMTP' }, { status: 503 });

  const signer = { nama: user.name, jabatan: JABATAN[user.role] || '', email: user.email && validEmail(user.email) ? user.email : '' };
  const logoBuf = await logo();
  const withLogo = (extra: typeof files) => (logoBuf ? [...extra, { filename: 'logo.png', content: logoBuf, contentType: 'image/png', cid: 'tira-logo' }] : extra);
  const names = files.map((f) => f.filename);

  if (mode === 'internal') {
    const users = await internalRecipients(user.id, body.internal || {});
    if (!users.length) return NextResponse.json({ error: 'Pilih penerima pengumuman.' }, { status: 400 });
    if (users.length > MAIL_MAX_RECIPIENTS) return NextResponse.json({ error: `Maksimal ${MAIL_MAX_RECIPIENTS} penerima sekali kirim.` }, { status: 400 });
    let sent = 0;
    const failed: string[] = [];
    let noEmail = 0;
    if (mailConfigured()) {
      for (const u of users) {
        if (!u.email || !validEmail(u.email)) {
          noEmail++;
          continue;
        }
        const input = { mode, message, attachments: names, greeting: `Halo ${u.name.split(/\s+/)[0]}`, signer, logoSrc: logoBuf ? 'cid:tira-logo' : '' };
        const res = await sendCustomerMail({
          userId: user.id,
          kind: 'pengumuman',
          senderName: user.name,
          replyTo: signer.email || undefined,
          to: [u.email],
          cc: [],
          subject: `[CRM TIRA] ${subject}`,
          html: composeEmailHtml(input),
          text: composeEmailText(input),
          attachments: withLogo(files),
        });
        if (res.ok) sent++;
        else failed.push(u.name);
      }
    } else noEmail = users.length;
    // Juga di tab Notifikasi CRM (untuk semua penerima, termasuk yang tanpa email).
    let inApp = 0;
    if (body.internal?.inApp) {
      const rows = await Promise.all(
        users.map((u) =>
          prisma.notification.create({
            data: { userId: u.id, type: 'announcement', entity: 'announcement', entityId: user.id, title: `📢 ${subject}`.slice(0, 200), message: `${user.name}: ${message}`.slice(0, 1500), emailedAt: new Date() },
          }),
        ),
      );
      rows.forEach((n) => emitCrmEvent('notification:new', n));
      inApp = rows.length;
    }
    await logActivity({ user, action: 'create', entity: 'user', entityId: user.id, summary: `Mengirim pengumuman "${subject}" ke ${users.length} user (email terkirim ${sent}${failed.length ? `, gagal ${failed.length}` : ''}${noEmail ? `, tanpa email ${noEmail}` : ''}${inApp ? `, notifikasi CRM ${inApp}` : ''})` });
    return NextResponse.json({ ok: true, total: users.length, sent, failed, noEmail, inApp });
  }

  // ---- email ke customer
  const reqs = (Array.isArray(body.customer?.recipients) ? body.customer.recipients : []) as { customerId?: unknown; emails?: unknown }[];
  if (!reqs.length) return NextResponse.json({ error: 'Pilih minimal satu customer.' }, { status: 400 });
  const ids = reqs.map((r) => String(r.customerId || ''));
  const customers = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, pics: true } });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const cc = Array.from(new Set([...list(body.customer?.cc), ...(body.customer?.ccSelf && signer.email ? [signer.email] : [])]));
  const badCc = cc.find((e) => !validEmail(e));
  if (badCc) return NextResponse.json({ error: `Alamat CC tidak valid: ${badCc}` }, { status: 400 });
  const totalTo = reqs.reduce((n, r) => n + list(r.emails).length, 0);
  if (totalTo > MAIL_MAX_RECIPIENTS) return NextResponse.json({ error: `Maksimal ${MAIL_MAX_RECIPIENTS} alamat sekali kirim.` }, { status: 400 });

  let sent = 0;
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const r of reqs) {
    const c = byId.get(String(r.customerId || ''));
    if (!c) continue;
    // Hanya alamat yang memang tercatat di customer ini.
    const known = new Set(
      [c.email, ...((Array.isArray(c.pics) ? c.pics : []) as { email?: string | null }[]).map((p) => p?.email)]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const to = list(r.emails).filter((e) => validEmail(e) && known.has(e.toLowerCase()));
    if (!to.length) {
      skipped.push(c.name);
      continue;
    }
    const input = { mode, message, attachments: names, greeting: 'Dengan hormat', signer, logoSrc: logoBuf ? 'cid:tira-logo' : '' };
    const res = await sendCustomerMail({
      userId: user.id,
      kind: 'customer',
      senderName: user.name,
      replyTo: signer.email || undefined,
      to,
      cc,
      subject,
      html: composeEmailHtml(input),
      text: composeEmailText(input),
      attachments: withLogo(files),
    });
    if (res.ok) sent++;
    else failed.push(c.name);
  }
  await logActivity({ user, action: 'create', entity: 'customer', entityId: ids[0] || user.id, summary: `Mengirim email "${subject}" ke ${sent} customer${failed.length ? ` (gagal: ${failed.join(', ')})` : ''}${skipped.length ? ` (tanpa email: ${skipped.join(', ')})` : ''}` });
  return NextResponse.json({ ok: true, total: reqs.length, sent, failed, skipped });
}
