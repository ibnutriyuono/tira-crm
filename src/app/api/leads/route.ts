import { NextResponse } from 'next/server';
import { ensureCustomerFromProspect } from '@/lib/customer-sync';
import { cabangRegMap } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { deriveFromMaterials, isResponse, requireUser } from '@/lib/api-helpers';
import { CABANG_LIST } from '@/lib/constants';
import { LEAD_SOURCE_LABEL, leadSourceLabel } from '@/lib/leads';
import { notifyLeadCreated } from '@/lib/leads-server';
import { invalidateMaterialLexicon } from '@/lib/material-lexicon-server';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Material } from '@/lib/types';

/** Lead hanya dimasukkan Product & Marketing (dan Admin), dengan hak Marketing "Tambah/Ubah". */
function canAddLead(role: string): boolean {
  return role === 'marketing' || role === 'admin';
}

/**
 * Product & Marketing memasukkan lead ke cabang tujuan. Lead disimpan sebagai
 * prospek berstatus 1 (Permintaan) dengan penanda lead; BM cabang (atau RM
 * bila cabang tanpa BM) dan SE yang dipilih diberi tahu. Pipeline tetap milik
 * cabang — Marketing tidak bisa mengubahnya setelah dikirim.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canAddLead(user.role)) return NextResponse.json({ error: 'Lead dimasukkan oleh Product & Marketing.' }, { status: 403 });
  const denied = await guard(user, 'marketing', 'e');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const customer = String(body?.customer || '').trim().replace(/\s+/g, ' ');
  const cabang = String(body?.cabang || '').trim().toUpperCase();
  const se = String(body?.se || '').trim().toUpperCase();
  const source = String(body?.source || '').trim();
  const phone = String(body?.phone || '').trim();
  const kontak = String(body?.kontak || '').trim().slice(0, 120);
  const catatan = String(body?.catatan || '').trim().slice(0, 1000);

  if (!customer) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });
  if (customer.length > 150) return NextResponse.json({ error: 'Nama customer terlalu panjang' }, { status: 400 });
  if (!CABANG_LIST.includes(cabang)) return NextResponse.json({ error: 'Pilih cabang tujuan' }, { status: 400 });
  if (!LEAD_SOURCE_LABEL[source]) return NextResponse.json({ error: 'Pilih sumber lead' }, { status: 400 });

  const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const materials: Material[] = rawItems
    .map((x) => x as { uraian?: unknown; qty?: unknown; line?: unknown })
    .map((x) => ({ line: String(x.line || '').trim(), uraian: String(x.uraian || '').trim().slice(0, 300), qty: Math.max(0, Number(x.qty) || 0), beratPc: 0, hargaKg: 0, harga: 0 }))
    .filter((m) => m.uraian);
  if (!materials.length) return NextResponse.json({ error: 'Isi minimal satu kebutuhan material' }, { status: 400 });

  if (se) {
    const owner = await prisma.user.findFirst({ where: { se: { equals: se, mode: 'insensitive' }, pausedAt: null }, select: { id: true } });
    if (!owner) return NextResponse.json({ error: `Kode SE ${se} tidak ditemukan / tidak aktif` }, { status: 400 });
  }

  const reg = (await cabangRegMap())[cabang] ?? null;
  const keterangan = [`Lead Marketing (${leadSourceLabel(source)})`, kontak ? `Kontak: ${kontak}` : '', catatan].filter(Boolean).join(' — ');

  const prospect = await prisma.prospect.create({
    data: {
      reg,
      cabang,
      se,
      customer,
      phone,
      ...deriveFromMaterials(materials),
      kondisiStock: '',
      keterangan,
      status: 1,
      penawaranTerkirim: false,
      qcdQuality: '',
      qcdCost: '',
      qcdDelivery: '',
      qcdKompetitor: '',
      qcdCatatan: '',
      leadSource: source,
      leadBy: user.name,
      leadById: user.id,
      leadAt: new Date(),
    },
  });

  emitCrmEvent('prospect:created', prospect);
  await logActivity({
    user,
    action: 'create',
    entity: 'prospect',
    entityId: prospect.id,
    summary: `Memasukkan lead "${customer}" (${leadSourceLabel(source)}) untuk cabang ${cabang}${se ? ` · SE ${se}` : ''}`,
  });
  await notifyLeadCreated(user, prospect);
  await ensureCustomerFromProspect(user, prospect);
  invalidateMaterialLexicon();
  return NextResponse.json({ prospect }, { status: 201 });
}
