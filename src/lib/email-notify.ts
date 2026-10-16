import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from './prisma';
import { INSTANT_DAILY_CAP, NOTIF_CATEGORIES, categoryOf, modeFor, normalizePrefs, validEmail } from './notif-prefs';

/**
 * Notifikasi email (server). Konfigurasi dari .env:
 *   SMTP_HOST, SMTP_PORT (587 / 465), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM ("CRM TIRA <crm@domain>"), APP_URL (alamat CRM untuk tombol "Buka di CRM").
 * Tanpa SMTP_HOST semua fungsi di sini diam (tidak mengirim apa pun), jadi
 * aplikasi tetap jalan di server yang belum diberi server email.
 */

interface NotifRow {
  id: string;
  userId: string;
  type: string;
  entity: string;
  entityId: string;
  title: string;
  message: string;
  createdAt: Date;
}

/** Jam Indonesia Barat (UTC+7, tanpa DST). */
const TZ_OFFSET_MIN = 7 * 60;

export function mailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'CRM TIRA <no-reply@localhost>';
}

function appUrl(): string {
  return (process.env.APP_URL || '').replace(/\/+$/, '');
}

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return transport;
}

/** Awal hari ini (WIB) sebagai Date UTC. */
export function startOfLocalDay(now = new Date()): Date {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60000);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - TZ_OFFSET_MIN * 60000);
}

function localParts(now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60000);
  return { dow: local.getUTCDay(), hhmm: `${String(local.getUTCHours()).padStart(2, '0')}.${String(local.getUTCMinutes()).padStart(2, '0')}`, date: local };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function link(notifId?: string): string {
  const base = appUrl();
  if (!base) return '';
  return notifId ? `${base}/?n=${encodeURIComponent(notifId)}` : `${base}/`;
}

function frame(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;color:#1b2430">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f4;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dfe5eb;border-radius:8px;overflow:hidden">
<tr><td style="background:#1b2430;color:#ffffff;padding:14px 20px"><b style="font-size:20px;letter-spacing:.5px">CRM TIRA</b><span style="float:right;font-size:11px;color:#9fb0c2;line-height:24px">Steel Division · PT. TIRA AUSTENITE, Tbk</span></td></tr>
<tr><td style="padding:20px;font-size:14px;line-height:1.5">${inner}
<p style="font-size:11px;color:#6b7684;border-top:1px solid #e3e9ef;padding-top:10px;margin-top:20px">Email otomatis dari CRM TIRA — jangan dibalas. Atur jenis email yang Anda terima di CRM › Notifikasi › Pengaturan.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function button(href: string, text: string, dark = false): string {
  if (!href) return '';
  return `<p style="margin:18px 0 0"><a href="${esc(href)}" style="display:inline-block;padding:11px 20px;border-radius:6px;background:${dark ? '#1b2430' : '#c47f2c'};color:#ffffff;font-weight:bold;text-decoration:none">${esc(text)}</a></p>`;
}

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'Bapak/Ibu';
}

export function renderInstant(n: Pick<NotifRow, 'id' | 'type' | 'title' | 'message'>, toName: string) {
  const cat = categoryOf(n.type);
  const subject = `[CRM TIRA] ${n.title}`;
  const html = frame(
    `<p style="margin:0 0 10px">Halo ${esc(firstName(toName))},</p>
<span style="display:inline-block;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:10px;background:#e7eef3;color:#24496b">${esc((cat?.label || 'Notifikasi').toUpperCase())}</span>
<p style="font-size:17px;font-weight:bold;margin:10px 0 6px">${esc(n.title)}</p>
<p style="margin:0">${esc(n.message)}</p>
${button(link(n.id), 'Buka di CRM')}`,
  );
  const text = `${n.title}\n${n.message}\n\n${link(n.id)}`;
  return { subject, html, text };
}

export function renderDigest(rows: Pick<NotifRow, 'id' | 'type' | 'title' | 'message'>[], toName: string, now = new Date()) {
  const tgl = localParts(now).date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const subject = `[CRM TIRA] Ringkasan ${tgl} — ${rows.length} notifikasi belum dibaca`;
  const groups = NOTIF_CATEGORIES.map((c) => ({ c, items: rows.filter((r) => c.types.includes(r.type)) })).filter((g) => g.items.length);
  const other = rows.filter((r) => !categoryOf(r.type));
  if (other.length) groups.push({ c: { key: 'lain', label: 'Lainnya', hint: '', def: 'ringkasan', types: [] }, items: other });
  const body = groups
    .map(
      (g) => `<p style="font-size:11px;font-weight:bold;letter-spacing:.8px;color:#4b5560;margin:16px 0 6px">${esc(g.c.label.toUpperCase())} · ${g.items.length}</p>
${g.items
  .map(
    (it) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3e9ef;border-radius:6px;margin-bottom:6px"><tr>
<td style="padding:8px 10px;font-size:13px"><b>${esc(it.title)}</b> — ${esc(it.message)}</td>
${link(it.id) ? `<td style="padding:8px 10px;font-size:12px;white-space:nowrap" align="right"><a href="${esc(link(it.id))}">Buka ›</a></td>` : ''}</tr></table>`,
  )
  .join('')}`,
    )
    .join('');
  const html = frame(`<p style="margin:0 0 6px">Halo ${esc(firstName(toName))}, berikut yang menunggu Anda di CRM:</p>${body}${button(link(), 'Buka CRM TIRA', true)}`);
  const text = rows.map((r) => `- ${r.title}: ${r.message}`).join('\n') + (link() ? `\n\n${link()}` : '');
  return { subject, html, text };
}

async function deliver(userId: string | null, kind: string, to: string, msg: { subject: string; html: string; text: string }): Promise<boolean> {
  try {
    await getTransport().sendMail({ from: fromAddress(), to, subject: msg.subject, html: msg.html, text: msg.text });
    await prisma.emailLog.create({ data: { userId, kind, to, subject: msg.subject.slice(0, 300), ok: true } });
    return true;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await prisma.emailLog.create({ data: { userId, kind, to, subject: msg.subject.slice(0, 300), ok: false, error } }).catch(() => {});
    console.error('[email] gagal kirim ke', to, error);
    return false;
  }
}

/**
 * Dipanggil notify() setelah baris Notification dibuat: kirim email langsung
 * untuk penerima yang memilih "Langsung" pada kategori itu (maks.
 * INSTANT_DAILY_CAP per hari). Yang lain dibiarkan untuk ringkasan harian.
 */
export async function emailNewNotifications(rows: NotifRow[]): Promise<void> {
  if (!mailConfigured() || rows.length === 0) return;
  const users = (await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(rows.map((r) => r.userId))) } },
    select: { id: true, name: true, email: true, notifPrefs: true },
  })) as { id: string; name: string; email: string | null; notifPrefs: unknown }[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const since = startOfLocalDay();
  for (const n of rows) {
    const u = byId.get(n.userId);
    const to = (u?.email || '').trim();
    if (!u || !validEmail(to)) continue;
    if (modeFor(normalizePrefs(u.notifPrefs), n.type) !== 'langsung') continue;
    const sentToday = await prisma.emailLog.count({ where: { userId: u.id, kind: 'langsung', ok: true, createdAt: { gte: since } } });
    if (sentToday >= INSTANT_DAILY_CAP) continue; // lewat batas: ikut ringkasan
    if (await deliver(u.id, 'langsung', to, renderInstant(n, u.name))) {
      await prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    }
  }
}

/**
 * Ringkasan harian: untuk tiap user ber-email yang jam ringkasannya sudah
 * lewat hari ini dan belum dikirimi ringkasan hari ini, kirim satu email berisi
 * notifikasi yang belum dibaca & belum pernah di-email (7 hari terakhir), selain
 * kategori yang dimatikan. Aman dipanggil berkali-kali (penjadwal tiap 5 menit).
 */
export async function runDailyDigest(now = new Date()): Promise<{ sent: number; skipped: number }> {
  if (!mailConfigured()) return { sent: 0, skipped: 0 };
  const { dow, hhmm } = localParts(now);
  const since = startOfLocalDay(now);
  const users = (await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, name: true, email: true, notifPrefs: true },
  })) as { id: string; name: string; email: string | null; notifPrefs: unknown }[];
  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    const to = (u.email || '').trim();
    if (!validEmail(to)) continue;
    const prefs = normalizePrefs(u.notifPrefs);
    if (prefs.hari === 'kerja' && (dow === 0 || dow === 6)) continue;
    if (hhmm < prefs.jam) continue;
    const done = await prisma.emailLog.count({ where: { userId: u.id, kind: { in: ['ringkasan', 'ringkasan-kosong'] }, createdAt: { gte: since } } });
    if (done) continue;
    const rows = ((await prisma.notification.findMany({
      where: { userId: u.id, readAt: null, emailedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })) as NotifRow[]).filter((r) => modeFor(prefs, r.type) !== 'mati');
    if (rows.length === 0) {
      await prisma.emailLog.create({ data: { userId: u.id, kind: 'ringkasan-kosong', to, subject: '(tidak ada notifikasi)' } });
      skipped++;
      continue;
    }
    if (await deliver(u.id, 'ringkasan', to, renderDigest(rows, u.name, now))) {
      await prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { emailedAt: new Date() } });
      sent++;
    }
  }
  return { sent, skipped };
}

export async function sendTestEmail(user: { id: string; name: string }, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailConfigured()) return { ok: false, error: 'Server email belum dikonfigurasi (SMTP_HOST di .env).' };
  const msg = renderInstant({ id: '', type: 'uji', title: 'Email uji CRM TIRA', message: 'Notifikasi email untuk akun Anda sudah aktif.' }, user.name);
  const ok = await deliver(user.id, 'uji', to, msg);
  if (ok) return { ok };
  const last = await prisma.emailLog.findFirst({ where: { userId: user.id, kind: 'uji' }, orderBy: { createdAt: 'desc' }, select: { error: true } });
  return { ok, error: last?.error || 'Gagal mengirim email.' };
}

export async function mailStatus() {
  const since = startOfLocalDay();
  const [sent, failed, lastErr] = await Promise.all([
    prisma.emailLog.count({ where: { ok: true, kind: { not: 'ringkasan-kosong' }, createdAt: { gte: since } } }),
    prisma.emailLog.count({ where: { ok: false, createdAt: { gte: since } } }),
    prisma.emailLog.findFirst({ where: { ok: false }, orderBy: { createdAt: 'desc' }, select: { error: true, createdAt: true } }),
  ]);
  return {
    configured: mailConfigured(),
    from: fromAddress(),
    server: process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${Number(process.env.SMTP_PORT) || 587}` : null,
    appUrl: appUrl() || null,
    sentToday: sent,
    failedToday: failed,
    lastError: lastErr ? { error: lastErr.error, at: lastErr.createdAt } : null,
    cap: INSTANT_DAILY_CAP,
  };
}
