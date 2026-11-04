import { NextResponse } from 'next/server';
import { docScopeWhere } from '@/lib/auth';
import { nextFupaNo } from '@/lib/fupa-number';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { cleanSppDoc, sppFileBase, type SppDoc } from '@/lib/spp-doc';
import { buildSppDocx, buildSppXlsx, defaultSppDoc } from '@/lib/spp-fupa';
import type { SafeUser } from '@/lib/types';

export const SPP_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
export type SppFormat = keyof typeof SPP_TYPES;

/** FUP A dalam cakupan user (+ nomor otomatis bila kosong) beserta isi SPP awal dari CRM. */
export async function loadSpp(user: SafeUser, id: string): Promise<{ error: NextResponse } | { fupa: { id: string; noFupa: string | null; customer: string | null; spp: unknown }; auto: SppDoc; saved: SppDoc | null }> {
  let fupa = await prisma.fupa.findFirst({ where: { AND: [{ id }, await docScopeWhere(user, { table: 'fupa' })] } });
  if (!fupa) return { error: NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 }) };
  if (!(fupa.noFupa || '').trim()) {
    fupa = await prisma.fupa.update({ where: { id }, data: { noFupa: await nextFupaNo(fupa.cabang, fupa.tglFupa) } });
    emitCrmEvent('fupa:updated', fupa);
  }
  let prospectId = fupa.prospectId;
  if (!prospectId && fupa.sourceRfqId) prospectId = (await prisma.rfq.findUnique({ where: { id: fupa.sourceRfqId }, select: { prospectId: true } }))?.prospectId ?? null;
  const prospect = prospectId ? await prisma.prospect.findUnique({ where: { id: prospectId }, select: { noPo: true, tglDelivery: true, materials: true, status: true } }) : null;
  const auto = defaultSppDoc(fupa, prospect);
  const saved = fupa.spp && typeof fupa.spp === 'object' ? cleanSppDoc(fupa.spp, auto) : null;
  // Nomor FUP A selalu mengikuti dokumennya.
  if (saved) saved.noFupa = auto.noFupa;
  return { fupa, auto, saved };
}

export async function buildSppFile(doc: SppDoc, format: SppFormat): Promise<{ filename: string; content: Buffer; contentType: string }> {
  const content = format === 'docx' ? await buildSppDocx(doc) : await buildSppXlsx(doc);
  return { filename: `${sppFileBase(doc)}.${format}`, content, contentType: SPP_TYPES[format] };
}
