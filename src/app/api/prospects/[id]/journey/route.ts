import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { getProspectMaterials, num } from '@/lib/format';
import { checkQuoteMargins, type QuoteLineIn } from '@/lib/margin-check';
import { materialToRow, rowBeratPc, rowUraian, isFabRow, type SpecExtra } from '@/lib/material-spec';
import { getOpsRules } from '@/lib/ops-escalation';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { docScopeWhere } from '@/lib/auth';
import { canSeeHpp } from '@/lib/roles';
import type { Material, Prospect } from '@/lib/types';

/**
 * Perjalanan satu prospek untuk panel detail: riwayat per item (penawaran,
 * revisi, PO, kirim / DO, koreksi), perpindahan status, persetujuan margin,
 * dan — sesuai role — margin per item:
 *  - BM: hanya persentase margin (tanpa HPP / harga pokok);
 *  - RM, GM, GM Operation, VP, Admin & Purchasing: HPP/kg, harga/kg, margin,
 *    total HPP dan laba kotor;
 *  - Sales & role lain: tanpa margin.
 * Margin dihitung dari HPP jawaban RFQ yang terhubung ke prospek ini.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'v');
  if (denied) return denied;
  const { id } = await params;
  const scoped = await assertProspectInScope(user, id);
  if ('error' in scoped) return scoped.error;
  const p = scoped.existing as unknown as Prospect;

  const [rfqDocs, fupaDocs] = await Promise.all([
    prisma.rfq.findMany({ where: { AND: [{ prospectId: id }, await docScopeWhere(user)] }, select: { id: true, noRfq: true } }),
    prisma.fupa.findMany({ where: { AND: [{ prospectId: id }, await docScopeWhere(user, { table: 'fupa' })] }, select: { id: true, noFupa: true } }),
  ]);
  const threadLabel = new Map<string, string>([[`prospect:${id}`, 'Prospek']]);
  rfqDocs.forEach((r) => threadLabel.set(`rfq:${r.id}`, `RFQ ${r.noRfq || '(draft)'}`));
  fupaDocs.forEach((f) => threadLabel.set(`fupa:${f.id}`, `FUP A ${f.noFupa || '(draft)'}`));

  const [events, logs, approvals, msgs, acts] = await Promise.all([
    prisma.prospectItemEvent.findMany({ where: { prospectId: id }, orderBy: { createdAt: 'asc' }, take: 300 }),
    prisma.activityLog.findMany({
      where: { entity: 'prospect', entityId: id, action: { in: ['create', 'status_change'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { createdAt: true, actorName: true, action: true, summary: true },
    }),
    prisma.marginApproval.findMany({
      where: { prospectId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nomor: true, status: true, level: true, requestedByName: true, decidedByName: true, decidedAt: true, createdAt: true, lowestMargin: true },
    }),
    // Diskusi: thread prospek + RFQ / FUP A terkait yang boleh dilihat user ini.
    prisma.itemMessage.findMany({
      where: {
        OR: [
          { entity: 'prospect', entityId: id },
          ...(rfqDocs.length ? [{ entity: 'rfq', entityId: { in: rfqDocs.map((r) => r.id) } }] : []),
          ...(fupaDocs.length ? [{ entity: 'fupa', entityId: { in: fupaDocs.map((f) => f.id) } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    // Follow-up & aktivitas Sales yang terhubung ke prospek ini.
    prisma.salesActivity.findMany({
      where: { prospectId: id },
      orderBy: [{ tanggal: 'desc' }, { createdAt: 'desc' }],
      take: 60,
      select: { id: true, tanggal: true, tipe: true, kanal: true, hasil: true, keterangan: true, langkah: true, status: true, sumber: true, se: true, pics: true, createdBy: true, createdAt: true },
    }),
  ]);

  const full = canSeeHpp(user.role);
  const marginOnly = !full && user.role === 'bm';
  let margin: null | {
    level: 'margin' | 'full';
    minMargin: number;
    lines: { idx: number; margin: number | null; below: boolean; hpp?: number | null; price?: number | null; uom?: string; rfqNo: string; kg: number; nilai: number }[];
    total: { margin: number | null; checked: number; hpp?: number | null; nilai?: number | null; laba?: number | null };
  } = null;

  if (full || marginOnly) {
    const rules = await getOpsRules();
    const mats = getProspectMaterials(p) as (Material & SpecExtra)[];
    const rows = mats.map((m) => materialToRow(m));
    const quote: QuoteLineIn[] = rows.map((r) => ({
      line: r.line,
      uraian: rowUraian(r),
      grade: r.grade,
      qty: num(r.pcs),
      beratPc: isFabRow(r) ? 0 : rowBeratPc(r),
      hargaKg: num(r.hargaKg),
      harga: isFabRow(r) ? num(r.hargaUnit) : num(r.hargaKg) * rowBeratPc(r),
    }));
    const checked = await checkQuoteMargins(id, quote, rules.marginMin);
    let sumHpp = 0;
    let sumNilai = 0;
    let n = 0;
    const lines = checked.map((c, i) => {
      const kg = (quote[i].beratPc || 0) * (quote[i].qty || 0);
      const isKg = !c.uom || /^kg$/i.test(c.uom);
      const units = isKg ? kg : quote[i].qty || 0;
      if (c.checked && c.hpp && c.price) {
        sumHpp += c.hpp * units;
        sumNilai += c.price * units;
        n++;
      }
      const base = { idx: c.idx, margin: c.checked ? c.margin : null, below: c.below, rfqNo: c.rfqNo, kg, nilai: (c.price || 0) * units };
      return full ? { ...base, hpp: c.hpp, price: c.price, uom: c.uom } : { ...base, nilai: 0 };
    });
    const tot = sumHpp > 0 ? Math.round((sumNilai / sumHpp - 1) * 1000) / 10 : null;
    margin = {
      level: full ? 'full' : 'margin',
      minMargin: rules.marginMin,
      lines,
      total: full ? { margin: tot, checked: n, hpp: sumHpp || null, nilai: sumNilai || null, laba: sumHpp ? sumNilai - sumHpp : null } : { margin: tot, checked: n },
    };
  }

  return NextResponse.json({
    events: events.map((e) => ({ id: e.id, type: e.type, tgl: e.tgl, docNo: e.docNo, title: e.title, items: e.items, actorName: e.actorName, createdAt: e.createdAt })),
    status: logs.map((l) => ({ at: l.createdAt, by: l.actorName, action: l.action, summary: l.summary })),
    discussions: msgs.map((m) => ({ id: m.id, entity: m.entity, entityId: m.entityId, thread: threadLabel.get(`${m.entity}:${m.entityId}`) || m.entity, author: m.author, role: m.role, text: m.text, createdAt: m.createdAt })),
    activities: acts,
    approvals: approvals.map((a) => ({ ...a, lowestMargin: full || marginOnly ? a.lowestMargin : null })),
    margin,
  });
}
