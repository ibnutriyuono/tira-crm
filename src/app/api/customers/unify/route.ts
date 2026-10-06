import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { mergePics } from '@/lib/customer-sync';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { CustomerPic, TripVisit } from '@/lib/types';

/**
 * Satukan Nama Customer: every record written with one of the `from`
 * spellings is renamed to `to` -- prospects, daily activities, RFQ, FUP A,
 * visit-trip stops -- and duplicate Kelola Customer entries are merged into
 * one (PICs combined, empty contact fields filled from the duplicates).
 * GM/Admin only: it rewrites data across every branch.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'gm' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya GM / Admin yang dapat menyatukan nama customer.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const to = String(body?.to || '').trim().replace(/\s+/g, ' ');
  const from = Array.from(new Set((Array.isArray(body?.from) ? body.from : []).map((s: unknown) => String(s || '').trim()).filter(Boolean))) as string[];
  if (!to || to.length > 150) return NextResponse.json({ error: 'Nama baku wajib diisi (maks. 150 karakter)' }, { status: 400 });
  const variants = from.filter((n) => n !== to);
  if (variants.length === 0) return NextResponse.json({ error: 'Pilih minimal satu ejaan lain untuk disatukan' }, { status: 400 });
  if (variants.length > 50) return NextResponse.json({ error: 'Terlalu banyak ejaan sekaligus (maks. 50)' }, { status: 400 });

  const lower = new Set([...variants, to].map((n) => n.toLowerCase()));
  const anyOf = (field: string) => ({ OR: variants.map((n) => ({ [field]: { equals: n, mode: 'insensitive' as const } })) });
  // Records already spelled exactly `to` are left alone (only case variants of
  // `to` itself are touched, through the insensitive match above).

  const result = await prisma.$transaction(async (tx) => {
    const prospects = await tx.prospect.updateMany({ where: anyOf('customer'), data: { customer: to } });
    const activities = await tx.salesActivity.updateMany({ where: anyOf('customer'), data: { customer: to } });
    const rfqs = await tx.rfq.updateMany({ where: anyOf('customer'), data: { customer: to } });
    const fupas = await tx.fupa.updateMany({ where: anyOf('customer'), data: { customer: to } });

    // Visit-trip stops live in a JSON list.
    let trips = 0;
    const allTrips = await tx.visitTrip.findMany({ select: { id: true, visits: true } });
    for (const t of allTrips) {
      const visits = (Array.isArray(t.visits) ? t.visits : []) as unknown as TripVisit[];
      let changed = false;
      const next = visits.map((v) => {
        const n = String(v?.customer || '').trim();
        if (n && n !== to && lower.has(n.toLowerCase())) {
          changed = true;
          return { ...v, customer: to };
        }
        return v;
      });
      if (changed) {
        await tx.visitTrip.update({ where: { id: t.id }, data: { visits: next as unknown as Prisma.InputJsonValue } });
        trips++;
      }
    }

    // Kelola Customer: keep one entry, named `to`.
    const dupes = await tx.customer.findMany({
      where: { OR: [...variants, to].map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })) },
      orderBy: { createdAt: 'asc' },
    });
    let mergedCustomers = 0;
    let keptId: string | null = null;
    if (dupes.length) {
      const keep = dupes.find((c) => c.name === to) || dupes.find((c) => c.name.toLowerCase() === to.toLowerCase()) || dupes[0];
      keptId = keep.id;
      const others = dupes.filter((c) => c.id !== keep.id);
      const seed = (c: (typeof dupes)[number]): CustomerPic[] => {
        const list = Array.isArray(c.pics) ? (c.pics as unknown as CustomerPic[]) : [];
        return list.length === 0 && c.pic ? [{ id: `${c.id}-pic`, nama: c.pic, jabatan: null, phone: c.phone || null, email: c.email || null, isPrimary: true }] : list;
      };
      let pics = seed(keep);
      for (const o of others) {
        const extra = seed(o);
        pics = mergePics(pics, extra.map((p) => ({ nama: p.nama, jabatan: p.jabatan }))) || pics;
        // Carry over phone/email for PICs that came only from the duplicate.
        pics = pics.map((p) => {
          const src = extra.find((e) => e.nama.trim().toLowerCase() === p.nama.trim().toLowerCase());
          return src ? { ...p, phone: p.phone || src.phone || null, email: p.email || src.email || null } : p;
        });
      }
      const pick = (field: 'phone' | 'email' | 'address' | 'cabang') => keep[field] || others.map((o) => o[field]).find((v) => v) || keep[field];
      const notes = [keep.catatan, ...others.map((o) => o.catatan)].filter((v, i, a) => v && a.indexOf(v) === i).join('\n');
      const primary = pics.find((p) => p.isPrimary) || pics[0];
      await tx.customer.update({
        where: { id: keep.id },
        data: {
          name: to,
          cabang: pick('cabang'),
          phone: pick('phone'),
          email: pick('email'),
          address: pick('address'),
          catatan: notes || keep.catatan,
          pic: primary?.nama ?? keep.pic,
          pics: pics as unknown as Prisma.InputJsonValue,
        },
      });
      if (others.length) await tx.customer.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
      mergedCustomers = others.length;
    }
    return { prospects: prospects.count, activities: activities.count, rfqs: rfqs.count, fupas: fupas.count, trips, mergedCustomers, keptId };
  });

  // Many record types changed at once: every open client reloads its data.
  emitCrmEvent('data:refresh', { reason: 'customer-unify' });
  await logActivity({
    user,
    action: 'update',
    entity: 'customer',
    entityId: result.keptId || undefined,
    summary: `Menyatukan nama customer menjadi "${to}" dari ${variants.map((v) => `"${v}"`).join(', ')} — ${result.prospects} prospek, ${result.activities} aktivitas, ${result.rfqs} RFQ, ${result.fupas} FUP A, ${result.trips} perjalanan, ${result.mergedCustomers} data customer ganda digabung`,
  });
  return NextResponse.json(result);
}
