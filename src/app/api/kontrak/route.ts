import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { logActivity } from '@/lib/activity';
import { cabangRegMap } from '@/lib/auth';
import { canDecideKontrak, canEditKontrak, cleanKontrakInput, itemCreateData, logKontrak, nextNomor, realisasi, scopeFilter, toKontrak } from '@/lib/kontrak-server';

/**
 * Kontrak harga / qty customer.
 *   GET            → { kontrak, canEdit, pending }  (sesuai cakupan user, dengan realisasi)
 *   GET ?lite=1    → { kontrak } ringkas untuk badge Kelola Customer / panel prospek
 *   POST {…form}   → draft baru (Admin Sales / Admin)
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'v');
  if (denied) return denied;
  const lite = new URL(req.url).searchParams.get('lite') === '1';
  const rows = await prisma.kontrak.findMany({ include: { items: true }, orderBy: [{ tglAkhir: 'desc' }, { createdAt: 'desc' }] });
  const visible = await scopeFilter(user);
  const ks = rows.map(toKontrak).filter(visible);
  if (lite) {
    return NextResponse.json({
      kontrak: ks.filter((k) => k.status !== 'batal').map((k) => ({ id: k.id, nomor: k.nomor, jenis: k.jenis, grupNama: k.grupNama, groupId: k.groupId, entitas: k.entitas, cabangs: k.cabangs, status: k.status, tglMulai: k.tglMulai, tglAkhir: k.tglAkhir })),
    });
  }
  const reals = await realisasi(ks.filter((k) => k.status === 'aktif'));
  const nexts = new Map(ks.filter((k) => k.prevId && k.status !== 'batal').map((k) => [k.prevId as string, k]));
  let pending = 0;
  const out = [];
  for (const k of ks) {
    const r = reals.get(k.id);
    const nx = nexts.get(k.id);
    let canDecide = false;
    for (const a of k.approvals) if (await canDecideKontrak(user, k, a)) canDecide = true;
    if (canDecide && k.status === 'menunggu') pending++;
    out.push({ ...k, real: r?.real, poCount: r?.poCount || 0, linkCount: r?.links.length || 0, nextId: nx?.id || null, nextNomor: nx?.nomor || null, canDecide });
  }
  return NextResponse.json({ kontrak: out, canEdit: canEditKontrak(user) && !(await guard(user, 'kontrak', 'e')), pending });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'e');
  if (denied) return denied;
  if (!canEditKontrak(user)) return NextResponse.json({ error: 'Kontrak diinput oleh Admin Sales.' }, { status: 403 });
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const input = cleanKontrakInput(b);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const cabang = String((user.role === 'salesadmin' ? user.cabang : b.cabang || input.cabangs[0]) || '').toUpperCase();
  if (!cabang) return NextResponse.json({ error: 'Cabang pemilik kontrak tidak diketahui.' }, { status: 400 });
  const reg = user.role === 'salesadmin' && user.reg != null ? user.reg : ((await cabangRegMap())[cabang] ?? null);
  const nomor = await nextNomor(input.tglMulai);
  const { items, ...head } = input;
  const row = await prisma.kontrak.create({
    data: { ...head, nomor, cabang, reg, entitas: head.entitas, cabangs: head.cabangs, createdById: user.id, createdByName: user.name, items: { create: itemCreateData(items) } },
    include: { items: true },
  });
  await logKontrak(row.id, 'dibuat', head.prevId ? 'perpanjangan' : head.prospectId ? 'dari prospek' : null, user.name);
  await logActivity({ user, action: 'create', entity: 'kontrak', entityId: row.id, summary: `Membuat kontrak ${nomor} · ${head.grupNama}` });
  return NextResponse.json({ kontrak: toKontrak(row) });
}
