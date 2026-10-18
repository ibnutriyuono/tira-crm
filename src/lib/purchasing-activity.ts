/**
 * Pekerjaan Purchasing -> Aktivitas Harian (otomatis, sumber "purchasing").
 *
 * - Jawab RFQ / FUP A: saat jawaban dikirim / diisi. Satu baris per dokumen
 *   per hari; jawaban ulang di hari yang sama memperbarui baris itu.
 * - Diskusi di kartu (prospek / RFQ / FUP A): balasan Purchasing dirangkum
 *   satu baris per dokumen per hari ("Diskusi RFQ X: 3 balasan").
 *
 * Hanya untuk role Purchasing / PIC Line 05. Best-effort: kegagalan di sini
 * tidak boleh menggagalkan jawaban atau pesan yang sudah tersimpan.
 */
import { isPurchasingRole } from './auth';
import { prisma } from './prisma';
import { activityOwner } from './sales-activity';
import type { RfqItem, SafeUser } from './types';

export const PURCHASING_SOURCE = 'purchasing';

type DocKind = 'rfq' | 'fupa' | 'prospect';
const DOC_LABEL: Record<DocKind, string> = { rfq: 'RFQ', fupa: 'FUP A', prospect: 'prospek' };

/** Hari ini (WIB) "YYYY-MM-DD". */
const todayWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** "RFQ/DKI/2026/10/001" sudah memuat jenisnya; tanpa nomor -> "RFQ (tanpa nomor)". */
const docName = (kind: DocKind, no: string | null) => (kind === 'prospect' ? `prospek ${no || ''}`.trim() : no || `${DOC_LABEL[kind]} (tanpa nomor)`);

interface DocRef {
  kind: DocKind;
  id: string;
  no: string | null;
  customer: string | null;
  cabang: string | null;
  reg: number | null;
  prospectId?: string | null;
}

async function upsertRow(user: SafeUser, tipe: 'jawab_rfq' | 'diskusi', doc: DocRef, build: (prevKet: string | null) => string) {
  if (!isPurchasingRole(user.role)) return;
  const se = activityOwner(user);
  if (!se) return;
  const tanggal = todayWib();
  const refNo = `${tipe}:${doc.kind}:${doc.id}`;
  const existing = await prisma.salesActivity.findFirst({ where: { sumber: PURCHASING_SOURCE, refNo, tanggal, se: { equals: se, mode: 'insensitive' } } });
  const keterangan = build(existing?.keterangan ?? null).slice(0, 2000);
  if (existing) {
    await prisma.salesActivity.update({ where: { id: existing.id }, data: { keterangan } });
    return;
  }
  await prisma.salesActivity.create({
    data: {
      tanggal,
      se,
      cabang: doc.cabang ? doc.cabang.toUpperCase() : null,
      reg: doc.reg,
      tipe,
      customer: (doc.customer || '').trim() || '-',
      keterangan,
      pics: [],
      prospectId: doc.prospectId ?? null,
      status: 'selesai',
      sumber: PURCHASING_SOURCE,
      refNo,
      createdBy: user.name || user.username,
    },
  });
}

/** Jawaban RFQ dikirim ke Sales. */
export async function logRfqAnswer(user: SafeUser, rfq: { id: string; noRfq: string | null; customer: string | null; cabang: string | null; reg: number | null; requestedBy: string | null; items: unknown }) {
  try {
    const items = (Array.isArray(rfq.items) ? rfq.items : []) as RfqItem[];
    const priced = items.filter((it) => Number(it.hargaPurchasing) > 0).length;
    const noQuote = items.filter((it) => it.noQuote).length;
    await upsertRow(user, 'jawab_rfq', { kind: 'rfq', id: rfq.id, no: rfq.noRfq, customer: rfq.customer, cabang: rfq.cabang, reg: rfq.reg }, () =>
      [`Jawab ${docName('rfq', rfq.noRfq)}`, rfq.requestedBy && `pengaju ${rfq.requestedBy}`, `${priced} dari ${items.length} material diberi harga${noQuote ? `, ${noQuote} No Quote` : ''}`].filter(Boolean).join(' · '),
    );
  } catch (err) {
    console.error('[purchasing-activity] rfq', err);
  }
}

/** Jawaban FUP A diisi / diperbarui. */
export async function logFupaAnswer(user: SafeUser, fupa: { id: string; noFupa: string | null; customer: string | null; cabang: string | null; reg?: number | null; requestedBy: string | null; purchJawaban: string | null }) {
  try {
    await upsertRow(user, 'jawab_rfq', { kind: 'fupa', id: fupa.id, no: fupa.noFupa, customer: fupa.customer, cabang: fupa.cabang, reg: fupa.reg ?? null }, () =>
      [`Jawab ${docName('fupa', fupa.noFupa)}`, fupa.requestedBy && `pengaju ${fupa.requestedBy}`, fupa.purchJawaban && `"${clip(fupa.purchJawaban.trim(), 160)}"`].filter(Boolean).join(' · '),
    );
  } catch (err) {
    console.error('[purchasing-activity] fupa', err);
  }
}

/** Balasan Purchasing di diskusi kartu: dirangkum per dokumen per hari. */
export async function logDiscussion(user: SafeUser, kind: DocKind, entityId: string, text: string) {
  if (!isPurchasingRole(user.role)) return;
  try {
    let doc: DocRef | null = null;
    if (kind === 'rfq') {
      const r = await prisma.rfq.findUnique({ where: { id: entityId }, select: { noRfq: true, customer: true, cabang: true, reg: true } });
      if (r) doc = { kind, id: entityId, no: r.noRfq, customer: r.customer, cabang: r.cabang, reg: r.reg };
    } else if (kind === 'fupa') {
      const f = await prisma.fupa.findUnique({ where: { id: entityId }, select: { noFupa: true, customer: true, cabang: true, reg: true } });
      if (f) doc = { kind, id: entityId, no: f.noFupa, customer: f.customer, cabang: f.cabang, reg: f.reg };
    } else {
      const p = await prisma.prospect.findUnique({ where: { id: entityId }, select: { customer: true, cabang: true, reg: true, uraian: true } });
      if (p) doc = { kind, id: entityId, no: p.uraian ? clip(p.uraian, 60) : null, customer: p.customer, cabang: p.cabang, reg: p.reg, prospectId: entityId };
    }
    if (!doc) return;
    const d = doc;
    await upsertRow(user, 'diskusi', d, (prev) => {
      const n = (Number(/: (\d+) balasan/.exec(prev || '')?.[1]) || 0) + 1;
      return `Diskusi ${docName(kind, d.no)}: ${n} balasan · terakhir: "${clip(text.trim(), 120)}"`;
    });
  } catch (err) {
    console.error('[purchasing-activity] diskusi', err);
  }
}
