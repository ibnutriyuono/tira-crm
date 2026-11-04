import { NextResponse } from 'next/server';
import { logActivity } from './activity';
import { deriveFromMaterials } from './api-helpers';
import { cabangRegMap } from './auth';
import { ensureCustomerFromProspect } from './customer-sync';
import { num } from './format';
import { effectivePerms } from './permissions-server';
import { can } from './permissions';
import { prisma } from './prisma';
import { assertProspectInScope } from './prospect-access';
import { emitCrmEvent } from './socket';
import type { Material, RfqItem, SafeUser } from './types';

/**
 * RFQ dari Kelola RFQ wajib terhubung ke pipeline: pilih prospek yang ada
 * ({ prospectId }) atau buat prospek baru berstatus Permintaan dari isi RFQ
 * ({ createProspect: true }). Dipakai POST / PUT /api/rfqs.
 * Mengembalikan prospectId (atau null bila tidak diminta) / respons error.
 */
export async function resolveRfqProspect(
  user: SafeUser,
  body: { prospectId?: unknown; createProspect?: unknown; cabang?: unknown; customer?: unknown; items?: unknown },
): Promise<{ prospectId: string | null; created?: boolean } | { error: NextResponse }> {
  if (body?.createProspect) {
    if (!can(await effectivePerms(user), 'prospek', 'e')) return { error: NextResponse.json({ error: 'Role Anda tidak bisa membuat prospek — pilih prospek yang sudah ada.' }, { status: 403 }) };
    const customer = String(body.customer || '').trim();
    const cabang = String(body.cabang || user.cabang || '').trim().toUpperCase();
    if (!customer) return { error: NextResponse.json({ error: 'Isi customer dulu untuk membuat prospek baru.' }, { status: 400 }) };
    const items = (Array.isArray(body.items) ? body.items : []) as (RfqItem & Record<string, unknown>)[];
    const materials = items
      .filter((it) => String(it.material || '').trim())
      .map((it) => {
        const pcs = num(it.pcs);
        const beratPc = num(it.beratPc) || (pcs > 0 ? num(it.berat) / pcs : 0);
        const { hargaPurchasing: _h, currency: _c, uom: _u, deliveryTime: _d, coo: _o, note: _n, noQuote: _q, hpp: _hp, hppCur: _hc, kurs: _k, margin: _m, vendorId: _v, vendorNama: _vn, ...spec } = it;
        void [_h, _c, _u, _d, _o, _n, _q, _hp, _hc, _k, _m, _v, _vn];
        return { ...spec, line: String(it.line || ''), uraian: String(it.material || '').trim(), qty: pcs, beratPc: Math.round(beratPc * 100) / 100, hargaKg: 0, harga: 0 } as unknown as Material;
      });
    if (!materials.length) return { error: NextResponse.json({ error: 'Isi minimal satu material sebelum membuat prospek.' }, { status: 400 }) };
    const reg = (await cabangRegMap())[cabang] ?? user.reg ?? null;
    const se = user.role === 'sales' ? (user.se || '').toUpperCase() : '';
    const prospect = await prisma.prospect.create({
      data: {
        reg,
        cabang,
        se,
        customer,
        phone: '',
        ...deriveFromMaterials(materials),
        kondisiStock: '',
        keterangan: 'Dibuat dari RFQ (Kelola RFQ)',
        status: 1,
        penawaranTerkirim: false,
        qcdQuality: '',
        qcdCost: '',
        qcdDelivery: '',
        qcdKompetitor: '',
        qcdCatatan: '',
      },
    });
    emitCrmEvent('prospect:created', prospect);
    await logActivity({ user, action: 'create', entity: 'prospect', entityId: prospect.id, summary: `Membuat prospek "${customer}" (Permintaan) dari RFQ di Kelola RFQ` });
    await ensureCustomerFromProspect(user, prospect);
    return { prospectId: prospect.id, created: true };
  }
  const id = String(body?.prospectId || '').trim();
  if (!id) return { prospectId: null };
  const scoped = await assertProspectInScope(user, id);
  if (scoped.error) return { error: scoped.error };
  return { prospectId: id };
}

/** FUP A turunan RFQ ikut terhubung ke prospek yang sama (yang belum punya prospek). */
export async function linkFupasOfRfq(rfqId: string, prospectId: string): Promise<void> {
  const rows = await prisma.fupa.findMany({ where: { sourceRfqId: rfqId, prospectId: null }, select: { id: true } });
  for (const r of rows) {
    const f = await prisma.fupa.update({ where: { id: r.id }, data: { prospectId } });
    emitCrmEvent('fupa:updated', f);
  }
}
