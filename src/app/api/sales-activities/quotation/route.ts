import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser, resolveProspectScope } from '@/lib/api-helpers';
import { parsePicText } from '@/lib/customer-sync';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { quoteSignersFor } from '@/lib/quote-signers';
import { activityOwner, validTanggal } from '@/lib/sales-activity';

const QUOTATION_SOURCE = 'penawaran';

/**
 * Surat Penawaran -> Aktivitas Harian ("Kirim penawaran / dokumen") milik
 * pembuat surat. Satu nomor surat = satu baris: unduh ulang / kirim email
 * memperbarui baris yang sama.
 * Admin Sales / BM yang membuat surat atas nama Sales (signerId) mencatatnya
 * di Aktivitas Harian Sales tersebut, dengan "dibuat oleh" si pembuat.
 * Body: { prospectId, nomor, tanggal, customer, pic, ringkas, total, kanal?, signerId? }
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const nomor = String(body?.nomor || '').trim().slice(0, 80);
  const customer = String(body?.customer || '').trim().slice(0, 150);
  if (!nomor || !customer) return NextResponse.json({ error: 'Nomor surat dan customer wajib diisi' }, { status: 400 });
  const prospectId = body?.prospectId ? String(body.prospectId) : null;
  let prospect: { se: string | null; cabang: string | null; reg: number | null } | null = null;
  if (prospectId) {
    const scoped = await assertProspectInScope(user, prospectId);
    if (scoped.error) return scoped.error;
    prospect = scoped.existing;
  }

  // Pemilik aktivitas: pembuat surat, atau Sales/BM yang menjadi penanda tangan.
  const signerId = body?.signerId ? String(body.signerId) : '';
  let owner: { name: string; role: string; se: string | null; cabang: string | null; username: string } = user;
  if (signerId && signerId !== user.id) {
    const signer = prospect ? (await quoteSignersFor(user, prospect)).find((s) => s.id === signerId) : null;
    if (!signer) return NextResponse.json({ error: 'Penanda tangan tidak diizinkan untuk prospek ini' }, { status: 403 });
    owner = signer;
  }
  const onBehalf = owner !== user;
  const se = activityOwner(owner);
  if (!se) return NextResponse.json({ error: 'Akun ini belum memiliki identitas aktivitas.' }, { status: 403 });
  // Tanggal surat; bila di masa depan, aktivitasnya hari ini.
  const tanggal = validTanggal(body?.tanggal) || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const kanal = body?.kanal === 'email' ? 'email' : null;
  const ringkas = String(body?.ringkas || '').trim().slice(0, 400);
  const total = String(body?.total || '').trim().slice(0, 40);
  const keterangan = [`Surat penawaran No. ${nomor}`, ringkas, total && `total ${total}`, onBehalf && `dibuat oleh ${user.name}`].filter(Boolean).join(' · ').slice(0, 2000);
  const pics = parsePicText(String(body?.pic || '')).slice(0, 6).map((p, i) => ({ nama: p.nama, jabatan: p.jabatan || '', dihubungi: i === 0 }));
  const { reg, cabang } = onBehalf && prospect ? { reg: prospect.reg, cabang: (prospect.cabang || '').trim().toUpperCase() } : await resolveProspectScope(user, null);

  const existing = await prisma.salesActivity.findFirst({ where: { sumber: QUOTATION_SOURCE, refNo: nomor, se: { equals: se, mode: 'insensitive' } } });
  const data = {
    tanggal,
    customer,
    keterangan,
    pics: pics as unknown as Prisma.InputJsonValue,
    prospectId,
    ...(kanal || !existing ? { kanal: kanal ?? existing?.kanal ?? null } : {}),
  };
  const activity = existing
    ? await prisma.salesActivity.update({ where: { id: existing.id }, data })
    : await prisma.salesActivity.create({
        data: { ...data, se, cabang: cabang || null, reg, tipe: 'dokumen', status: 'selesai', sumber: QUOTATION_SOURCE, refNo: nomor, createdBy: user.name || user.username },
      });
  if (!existing) {
    await logActivity({ user, action: 'create', entity: 'salesActivity', entityId: activity.id, summary: `Surat penawaran No. ${nomor} ke "${customer}" tercatat di Aktivitas Harian${onBehalf ? ` ${owner.name} (atas nama, dibuat oleh ${user.name})` : ''}` });
  }
  return NextResponse.json({ activity, created: !existing, owner: owner.name });
}
