import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { logActivity } from '@/lib/activity';
import { getProspectMaterials } from '@/lib/format';
import { idxKey } from '@/lib/item-flow';
import { prospectInKontrak } from '@/lib/kontrak';
import { canEditKontrak, logKontrak, scopeFilter, toKontrak } from '@/lib/kontrak-server';
import type { Prospect } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

async function editable(id: string) {
  const user = await requireUser();
  if (isResponse(user)) return { res: user };
  const denied = await guard(user, 'kontrak', 'e');
  if (denied) return { res: denied };
  const row = await prisma.kontrak.findUnique({ where: { id }, include: { items: true } });
  if (!row) return { res: NextResponse.json({ error: 'Kontrak tidak ditemukan' }, { status: 404 }) };
  const k = toKontrak(row);
  if (!(await scopeFilter(user))(k) || !canEditKontrak(user, k)) return { res: NextResponse.json({ error: 'Realisasi kontrak dihubungkan oleh Admin Sales cabangnya.' }, { status: 403 }) };
  return { user, k };
}

/**
 * Hubungkan item prospek ke kontrak: { links: [{ prospectId, itemId, kontrakItemId, dimId }] }.
 * Item yang sudah terhubung ke kontrak lain dilewati.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const e = await editable(id);
  if ('res' in e) return e.res;
  const { user, k } = e;
  if (k.status !== 'aktif') return NextResponse.json({ error: 'Hanya kontrak aktif yang bisa dihubungkan ke PO.' }, { status: 409 });
  const b = ((await req.json().catch(() => null)) || {}) as { links?: unknown };
  const list = (Array.isArray(b.links) ? b.links : []).slice(0, 500) as Record<string, unknown>[];
  const pids = Array.from(new Set(list.map((l) => String(l.prospectId || ''))));
  const ps = await prisma.prospect.findMany({ where: { id: { in: pids } }, select: { id: true, customer: true, cabang: true, materials: true, qty: true, value: true, line: true, uraian: true, status: true } });
  const pById = new Map(ps.map((p) => [p.id, p]));
  const taken = await prisma.kontrakLink.findMany({ where: { prospectId: { in: pids } }, select: { prospectId: true, itemId: true } });
  const takenSet = new Set(taken.map((t) => `${t.prospectId}|${t.itemId}`));
  let n = 0;
  let skipped = 0;
  for (const l of list) {
    const p = pById.get(String(l.prospectId || ''));
    const it = k.items.find((x) => x.id === String(l.kontrakItemId || ''));
    const itemId = String(l.itemId || '');
    if (!p || !it || !itemId || ![4, 5].includes(Number(p.status)) || !prospectInKontrak(k, p)) { skipped++; continue; }
    const mats = getProspectMaterials(p as unknown as Prospect) as { itemId?: string }[];
    if (!mats.some((m, i) => (m.itemId || idxKey(i)) === itemId)) { skipped++; continue; }
    if (takenSet.has(`${p.id}|${itemId}`)) { skipped++; continue; }
    const dimId = l.dimId ? String(l.dimId) : null;
    await prisma.kontrakLink.create({ data: { kontrakId: k.id, kontrakItemId: it.id, dimId: dimId && it.dims.some((d) => d.id === dimId) ? dimId : null, prospectId: p.id, itemId, createdById: user.id, createdByName: user.name } });
    takenSet.add(`${p.id}|${itemId}`);
    n++;
  }
  if (n) {
    await logKontrak(k.id, 'realisasi dihubungkan', `${n} item dari ${new Set(list.map((l) => l.prospectId)).size} PO`, user.name);
    await logActivity({ user, action: 'update', entity: 'kontrak', entityId: k.id, summary: `Menghubungkan ${n} item PO ke kontrak ${k.nomor}` });
  }
  return NextResponse.json({ linked: n, skipped });
}

/** Lepas satu item: { linkId }. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const e = await editable(id);
  if ('res' in e) return e.res;
  const { user, k } = e;
  const b = ((await req.json().catch(() => null)) || {}) as { linkId?: string };
  const l = await prisma.kontrakLink.findFirst({ where: { id: String(b.linkId || ''), kontrakId: k.id } });
  if (!l) return NextResponse.json({ error: 'Tautan tidak ditemukan' }, { status: 404 });
  await prisma.kontrakLink.delete({ where: { id: l.id } });
  const p = await prisma.prospect.findUnique({ where: { id: l.prospectId }, select: { noPo: true, customer: true } });
  await logKontrak(k.id, 'realisasi dilepas', `${p?.noPo || 'PO'} · ${p?.customer || ''}`, user.name);
  return NextResponse.json({ ok: true });
}
