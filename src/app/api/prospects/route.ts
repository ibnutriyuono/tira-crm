import { NextResponse } from 'next/server';
import { prospectScopeWhere } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { cleanFaktor, cleanLevel } from '@/lib/qcd';
import { deriveFromMaterials, requireQcdOnClose, isResponse, requireNoPoOnMoveToPo, requireUser, resolveProspectScope } from '@/lib/api-helpers';
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

  const status = Number(body?.status) || 0;
  const noPo = String(body?.noPo || '').trim();
  const poErr = requireNoPoOnMoveToPo(null, status, noPo);
  if (poErr) return poErr;
  const qcdErr = requireQcdOnClose(null, status, body || {});
  if (qcdErr) return qcdErr;

  // Locked scope fields come from the account, not the request — see
  // api-helpers.ts#prospectScopeLocks.
  const { reg, cabang, se } = await resolveProspectScope(user, body);

  const prospect = await prisma.prospect.create({
    data: {
      reg,
      cabang,
      se,
      customer,
      phone: String(body?.phone || '').trim(),
      tglPenawaran: body?.tglPenawaran || null,
      noPo: noPo || null,
      tglPO: body?.tglPO || null,
      tglDelivery: body?.tglDelivery || null,
      ...derived,
      kondisiStock: String(body?.kondisiStock || '').trim(),
      keterangan: String(body?.keterangan || '').trim(),
      status,
      penawaranTerkirim: !!body?.penawaranTerkirim,
      terfaktur: !!body?.terfaktur,
      qcdQuality: body?.qcdQuality || '',
      qcdCost: body?.qcdCost || '',
      qcdDelivery: body?.qcdDelivery || '',
      qcdKompetitor: body?.qcdKompetitor || '',
      qcdCatatan: body?.qcdCatatan || '',
      qcdQualityLevel: cleanLevel(body?.qcdQualityLevel),
      qcdCostLevel: cleanLevel(body?.qcdCostLevel),
      qcdDeliveryLevel: cleanLevel(body?.qcdDeliveryLevel),
      qcdFaktor: cleanFaktor(body?.qcdFaktor),
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
