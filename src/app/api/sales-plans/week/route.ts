import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { deriveFromSalesPlanItems, isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, canEditSalesPlan, salesPlanScopeWhere } from '@/lib/auth';
import { num } from '@/lib/format';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { emitCrmEvent } from '@/lib/socket';
import type { SalesPlanItem } from '@/lib/types';

/**
 * Rencana Penjualan mingguan.
 *
 * Rencana aktif tetap disimpan di SalesPlan (satu per SE per bulan); setiap
 * baris diberi `minggu` (1–5). Rute ini menambah prospek ke minggu tertentu,
 * memindah minggunya, atau menghapusnya dengan alasan — semua tercatat di
 * SalesPlanChange supaya yang ditambah dan dihapus tetap terlihat.
 *
 *   GET    ?periode=YYYY-MM          → { changes }
 *   POST   { prospectId, periode, minggu, items, catatan }
 *   PATCH  { se, periode, index, uraian, minggu }     (jadwalkan / pindah satu baris)
 *   DELETE { periode, prospectId, reason } | { se, periode, index, uraian, reason }
 */

const PERIODE = /^\d{4}-\d{2}$/;
const sum = (rows: SalesPlanItem[]) => rows.reduce((a, r) => a + num(r.qty) * num(r.harga), 0);
const weekOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5;

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rencana', 'v');
  if (denied) return denied;
  const periode = new URL(req.url).searchParams.get('periode') || '';
  if (!PERIODE.test(periode)) return NextResponse.json({ error: 'Periode (YYYY-MM) wajib diisi' }, { status: 400 });
  const changes = await prisma.salesPlanChange.findMany({
    where: { AND: [{ periode }, await salesPlanScopeWhere(user)] },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  return NextResponse.json({ changes });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rencana', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const prospectId = String(body?.prospectId || '');
  const periode = String(body?.periode || '');
  const minggu = Number(body?.minggu);
  if (!prospectId || !PERIODE.test(periode) || !weekOk(minggu)) {
    return NextResponse.json({ error: 'Prospek, bulan dan minggu (W1–W5) wajib diisi' }, { status: 400 });
  }
  const scoped = await assertProspectInScope(user, prospectId);
  if ('error' in scoped) return scoped.error;
  const p = scoped.existing!;
  const se = String(p.se || '').trim();
  if (!se) return NextResponse.json({ error: 'Prospek belum punya Sales Engineer — isi SE di prospek dulu.' }, { status: 400 });
  const cabang = (p.cabang || '').trim().toUpperCase() || null;
  if (!canEditSalesPlan(user, se, cabang)) return NextResponse.json({ error: 'Anda tidak berhak mengisi rencana Sales ini.' }, { status: 403 });
  if (num(p.status) === 5 && p.terfaktur) return NextResponse.json({ error: 'Prospek yang sudah terfaktur tidak bisa dimasukkan ke rencana penjualan.' }, { status: 400 });
  if (num(p.status) === 6) return NextResponse.json({ error: 'Prospek Lose Order tidak bisa dimasukkan ke rencana penjualan.' }, { status: 400 });

  const catatan = String(body?.catatan || '').trim().slice(0, 300) || null;
  const now = new Date().toISOString();
  const by = user.name || user.username;
  const plan = await prisma.salesPlan.findUnique({ where: { se_periode: { se, periode } } });
  const current = ((plan?.items as unknown as SalesPlanItem[]) || []).slice();
  const old = current.filter((it) => it.sourceProspectId === prospectId);
  const others = current.filter((it) => it.sourceProspectId !== prospectId);
  const addedAt = old.find((it) => it.addedAt)?.addedAt || now;
  const addedBy = old.find((it) => it.addedBy)?.addedBy || by;
  const fresh = deriveFromSalesPlanItems(Array.isArray(body?.items) ? body.items : []).items.map((it) => ({
    ...it,
    sourceProspectId: prospectId,
    minggu,
    catatan,
    addedAt,
    addedBy,
  }));
  if (!fresh.length) return NextResponse.json({ error: 'Pilih minimal satu item yang direncanakan.' }, { status: 400 });

  const { items, value } = deriveFromSalesPlanItems([...others, ...fresh]);
  const reg = cabang ? ((await cabangRegMap())[cabang] ?? p.reg ?? null) : (p.reg ?? null);
  const salesPlan = await prisma.salesPlan.upsert({
    where: { se_periode: { se, periode } },
    create: { se, periode, cabang, reg, items: items as never, value, requestedBy: by },
    update: { items: items as never, value, requestedBy: by, ...(plan?.cabang ? {} : { cabang, reg }) },
  });
  const fromMinggu = old.length ? old[0].minggu ?? null : null;
  const action = !old.length ? 'tambah' : fromMinggu !== minggu ? 'pindah' : 'ubah';
  const change = await prisma.salesPlanChange.create({
    data: { periode, se, cabang, reg, action, minggu, fromMinggu, prospectId, customer: p.customer, items: fresh as never, nilai: sum(fresh), reason: catatan, byName: by },
  });
  emitCrmEvent('salesPlan:updated', salesPlan);
  const wl = `W${minggu}`;
  await logActivity({
    user,
    action: 'update',
    entity: 'salesPlan',
    entityId: salesPlan.id,
    summary:
      action === 'tambah'
        ? `Menambah ${p.customer} ke rencana penjualan ${se} ${periode} ${wl} (Rp ${Math.round(sum(fresh)).toLocaleString('id-ID')})`
        : action === 'pindah'
          ? `Memindah rencana ${p.customer} (${se} ${periode}) dari W${fromMinggu ?? '-'} ke ${wl}`
          : `Mengubah rencana ${p.customer} (${se} ${periode} ${wl})`,
  });
  return NextResponse.json({ salesPlan, change });
}

/** Jadwalkan / pindahkan satu baris rencana (termasuk baris yang diketik manual di Rencana Bulanan). */
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rencana', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const se = String(body?.se || '').trim();
  const periode = String(body?.periode || '');
  const index = Number(body?.index);
  const minggu = Number(body?.minggu);
  if (!se || !PERIODE.test(periode) || !Number.isInteger(index) || !weekOk(minggu)) {
    return NextResponse.json({ error: 'SE, bulan, baris dan minggu wajib diisi' }, { status: 400 });
  }
  const plan = await prisma.salesPlan.findUnique({ where: { se_periode: { se, periode } } });
  if (!plan) return NextResponse.json({ error: 'Rencana tidak ditemukan' }, { status: 404 });
  if (!canEditSalesPlan(user, plan.se, plan.cabang)) return NextResponse.json({ error: 'Anda tidak berhak mengubah rencana Sales ini.' }, { status: 403 });
  const items = ((plan.items as unknown as SalesPlanItem[]) || []).slice();
  const row = items[index];
  if (!row || String(row.uraian || '').trim() !== String(body?.uraian || '').trim()) {
    return NextResponse.json({ error: 'Rencana sudah berubah, muat ulang lalu coba lagi.' }, { status: 409 });
  }
  const fromMinggu = row.minggu ?? null;
  items[index] = { ...row, minggu, addedAt: row.addedAt || new Date().toISOString(), addedBy: row.addedBy || plan.requestedBy || null };
  const salesPlan = await prisma.salesPlan.update({ where: { id: plan.id }, data: { items: items as never } });
  await prisma.salesPlanChange.create({
    data: { periode, se, cabang: plan.cabang, reg: plan.reg, action: 'pindah', minggu, fromMinggu, prospectId: row.sourceProspectId || null, customer: null, items: [items[index]] as never, nilai: sum([row]), byName: user.name || user.username },
  });
  emitCrmEvent('salesPlan:updated', salesPlan);
  await logActivity({ user, action: 'update', entity: 'salesPlan', entityId: plan.id, summary: `Menjadwalkan "${String(row.uraian || '').trim()}" (${se} ${periode}) ke W${minggu}` });
  return NextResponse.json({ salesPlan });
}

/** Hapus dari rencana dengan alasan — baris lama tersimpan di riwayat. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'rencana', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const periode = String(body?.periode || '');
  const reason = String(body?.reason || '').trim().slice(0, 300);
  if (!PERIODE.test(periode)) return NextResponse.json({ error: 'Bulan wajib diisi' }, { status: 400 });
  if (reason.length < 3) return NextResponse.json({ error: 'Tulis alasan menghapus dari rencana.' }, { status: 400 });

  let se = String(body?.se || '').trim();
  const prospectId = String(body?.prospectId || '');
  let customer: string | null = null;
  if (prospectId) {
    const scoped = await assertProspectInScope(user, prospectId);
    if ('error' in scoped) return scoped.error;
    const p = scoped.existing!;
    se = String(p.se || '').trim();
    customer = p.customer;
    if (num(p.status) === 4 || num(p.status) === 5) {
      return NextResponse.json({ error: 'Prospek ini sudah PO / DO — tidak bisa dihapus dari rencana.' }, { status: 400 });
    }
  }
  const plan = se ? await prisma.salesPlan.findUnique({ where: { se_periode: { se, periode } } }) : null;
  if (!plan) return NextResponse.json({ error: 'Rencana tidak ditemukan' }, { status: 404 });
  if (!canEditSalesPlan(user, plan.se, plan.cabang)) return NextResponse.json({ error: 'Anda tidak berhak mengubah rencana Sales ini.' }, { status: 403 });

  const current = ((plan.items as unknown as SalesPlanItem[]) || []).slice();
  let removed: SalesPlanItem[];
  let remaining: SalesPlanItem[];
  if (prospectId) {
    removed = current.filter((it) => it.sourceProspectId === prospectId);
    remaining = current.filter((it) => it.sourceProspectId !== prospectId);
  } else {
    const index = Number(body?.index);
    const row = current[index];
    if (!row || String(row.uraian || '').trim() !== String(body?.uraian || '').trim()) {
      return NextResponse.json({ error: 'Rencana sudah berubah, muat ulang lalu coba lagi.' }, { status: 409 });
    }
    removed = [row];
    remaining = current.filter((_, i) => i !== index);
  }
  if (!removed.length) return NextResponse.json({ error: 'Item tidak ada di rencana.' }, { status: 404 });

  const by = user.name || user.username;
  await prisma.salesPlanChange.create({
    data: { periode, se: plan.se, cabang: plan.cabang, reg: plan.reg, action: 'hapus', minggu: removed[0].minggu ?? null, prospectId: prospectId || removed[0].sourceProspectId || null, customer, items: removed as never, nilai: sum(removed), reason, byName: by },
  });
  const what = customer || `"${String(removed[0].uraian || '').trim()}"`;
  if (!remaining.length) {
    await prisma.salesPlan.delete({ where: { id: plan.id } });
    emitCrmEvent('salesPlan:deleted', { id: plan.id });
    await logActivity({ user, action: 'delete', entity: 'salesPlan', entityId: plan.id, summary: `Menghapus ${what} dari rencana penjualan ${plan.se} ${periode} — ${reason}` });
    return NextResponse.json({ deleted: true, id: plan.id });
  }
  const { items, value } = deriveFromSalesPlanItems(remaining);
  const salesPlan = await prisma.salesPlan.update({ where: { id: plan.id }, data: { items: items as never, value } });
  emitCrmEvent('salesPlan:updated', salesPlan);
  await logActivity({ user, action: 'update', entity: 'salesPlan', entityId: plan.id, summary: `Menghapus ${what} dari rencana penjualan ${plan.se} ${periode} — ${reason}` });
  return NextResponse.json({ salesPlan });
}
