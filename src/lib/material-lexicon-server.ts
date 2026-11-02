import { prisma } from './prisma';
import { buildLexicon, type LexEntry, type MaterialLexicon } from './material-learn';

/**
 * Kamus material dari seluruh prospek, RFQ dan FUP A (lib/material-learn.ts).
 * Disimpan di memori server; dihitung ulang bila sudah 10 menit atau ada
 * prospek / RFQ yang baru disimpan (invalidateMaterialLexicon).
 */
let cache: { at: number; lex: MaterialLexicon } | null = null;
const TTL = 10 * 60 * 1000;

type Row = { uraian?: unknown; material?: unknown; grade?: unknown; bentuk?: unknown; line?: unknown };
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function getMaterialLexicon(): Promise<MaterialLexicon> {
  if (cache && Date.now() - cache.at < TTL) return cache.lex;
  const [prospects, rfqs, fupas] = await Promise.all([
    prisma.prospect.findMany({ select: { materials: true, uraian: true, line: true } }),
    prisma.rfq.findMany({ select: { items: true } }),
    prisma.fupa.findMany({ select: { items: true } }),
  ]);
  const entries: LexEntry[] = [];
  for (const p of prospects) {
    const ms = rows(p.materials);
    if (ms.length) ms.forEach((m) => entries.push({ uraian: str(m.uraian), grade: str(m.grade), bentuk: str(m.bentuk), line: str(m.line) }));
    else if (p.uraian) entries.push({ uraian: p.uraian, line: p.line });
  }
  for (const d of [...rfqs, ...fupas]) rows(d.items).forEach((m) => entries.push({ uraian: str(m.material), grade: str(m.grade), bentuk: str(m.bentuk), line: str(m.line) }));
  cache = { at: Date.now(), lex: buildLexicon(entries) };
  return cache.lex;
}

export function invalidateMaterialLexicon() {
  cache = null;
}
