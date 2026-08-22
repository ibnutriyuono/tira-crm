import { NextResponse } from 'next/server';
import { prospectScopeWhere } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { deriveFromMaterials, isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Material } from '@/lib/types';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const prospects = await prisma.prospect.findMany({
    where: prospectScopeWhere(user),
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ prospects });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const customer = String(body?.customer || '').trim();
  if (!customer) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });

  const materials: Material[] = Array.isArray(body?.materials) ? body.materials : [];
  if (!materials.some((m) => (m.uraian || '').trim())) {
    return NextResponse.json({ error: 'Isi minimal satu uraian material' }, { status: 400 });
  }
  const derived = deriveFromMaterials(materials);

  const isSales = user.role === 'sales';
  const cabang = (isSales ? user.cabang || '' : String(body?.cabang || '')).trim().toUpperCase();
  const se = (isSales ? user.se || '' : String(body?.se || '')).trim().toUpperCase();

  const prospect = await prisma.prospect.create({
    data: {
      reg: body?.reg != null ? Number(body.reg) : null,
      cabang,
      se,
      customer,
      phone: String(body?.phone || '').trim(),
      tglPenawaran: body?.tglPenawaran || null,
      tglPO: body?.tglPO || null,
      tglDelivery: body?.tglDelivery || null,
      ...derived,
      kondisiStock: String(body?.kondisiStock || '').trim(),
      keterangan: String(body?.keterangan || '').trim(),
      status: Number(body?.status) || 0,
      penawaranTerkirim: !!body?.penawaranTerkirim,
      terfaktur: !!body?.terfaktur,
      qcdQuality: body?.qcdQuality || '',
      qcdCost: body?.qcdCost || '',
      qcdDelivery: body?.qcdDelivery || '',
      qcdKompetitor: body?.qcdKompetitor || '',
      qcdCatatan: body?.qcdCatatan || '',
    },
  });

  emitCrmEvent('prospect:created', prospect);
  await logActivity({
    user,
    action: 'create',
    entity: 'prospect',
    entityId: prospect.id,
    summary: `Menambah prospek "${prospect.customer}"`,
  });
  return NextResponse.json({ prospect }, { status: 201 });
}
