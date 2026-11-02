import { normalizeLine } from './format';
import { GRADE_SUGGESTIONS, SHAPE_NAMES } from './material-spec';

/**
 * Kamus material yang "belajar" dari isian lama: grade dan nama material yang
 * pernah diketik di prospek, RFQ dan FUP A — beserta bentuk & Line yang
 * paling sering dipakai untuk grade itu. Dipakai untuk saran isian (grade,
 * uraian) dan untuk membaca teks material ("Tempel dari teks", uraian bebas).
 *
 * Hanya nama material — tanpa customer, harga atau jumlah — jadi aman dibagi
 * ke semua role.
 */

export interface LexGrade {
  /** Ejaan yang paling sering dipakai, mis. "AISI 4140". */
  g: string;
  /** Berapa kali dipakai. */
  n: number;
  /** Bentuk & Line yang paling sering untuk grade ini ('' bila belum ada). */
  bentuk: string;
  line: string;
}

export interface LexName {
  /** Nama material tanpa ukuran, mis. "Round Bar AISI 4140". */
  t: string;
  n: number;
  bentuk: string;
  grade: string;
  line: string;
}

export interface MaterialLexicon {
  grades: LexGrade[];
  names: LexName[];
}

export interface LexEntry {
  uraian?: string | null;
  grade?: string | null;
  bentuk?: string | null;
  line?: string | null;
}

export const EMPTY_LEX: MaterialLexicon = { grades: [], names: [] };

export const gradeKey = (g: string) => g.toUpperCase().replace(/[\s\-_./]/g, '');

/**
 * Merek / standar yang diikuti angka grade. Dipakai untuk mengenali grade di
 * uraian lama yang diketik bebas, mis. "Round Bar HQ 709 / AISI 4140 OD.60".
 * Prefix satu huruf (S45C, K110, P20, A36) hanya bila menempel ke angkanya.
 */
const BRANDS = ['creusabro', 'hardox', 'raex', 'quard', 'dillidur', 'abrazo', 'durostat', 'xar'];
const STD = ['aisi', 'sus', 'ss', 'jis', 'din', 'hq', 'tc', 'tw', 'sh', 'skd', 'sks', 'skh', 'scm', 'scr', 'sncm', 'vcn', 'st', 'df', 'ck', 'fcd', 'fc', 'spcc', 'sphc', 'sgcc'];
const SINGLE = ['s', 'k', 'p', 'a'];
const GRADE_TOKEN = new RegExp(`(?<![a-z0-9])(${[...BRANDS, ...STD, ...SINGLE].join('|')})([\\s-]?)(\\d{2,4}[a-z]{0,2})(?![a-z0-9])`, 'gi');

/** Grade yang terbaca dari teks bebas: ejaan rapi + potongan teks aslinya. */
export function gradeMatches(text: string): { g: string; raw: string }[] {
  const out: { g: string; raw: string }[] = [];
  for (const m of String(text || '').matchAll(GRADE_TOKEN)) {
    const pre = m[1].toLowerCase();
    const sep = m[2];
    const num = m[3].toUpperCase();
    if (SINGLE.includes(pre) && sep) continue;
    if (/^(MM|M)$/.test(num.replace(/\d/g, ''))) continue; // "S 20mm" dsb.
    const g = BRANDS.includes(pre) ? `${pre[0].toUpperCase()}${pre.slice(1)} ${num}` : SINGLE.includes(pre) || !sep ? `${pre.toUpperCase()}${num}` : `${pre.toUpperCase()} ${num}`;
    out.push({ g, raw: m[0] });
  }
  return out;
}

/** Merek tanpa seri (mis. "Plate Creusabro") → nama merek saja, untuk pengelompokan kasar. */
export function brandInText(text: string): string {
  const m = String(text || '').toLowerCase().match(new RegExp(`(?<![a-z])(${BRANDS.join('|')})(?![a-z])`));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)}` : '';
}

export function gradesInText(text: string): string[] {
  return gradeMatches(text).map((x) => x.g);
}

const SHAPE_WORDS: [RegExp, string][] = [
  [/round\s*bar|roundbar|\bas\b|\brb\b/i, 'Round Bar'],
  [/wire\s*mesh|wiremesh|\bmesh\b/i, 'Wire Mesh'],
  [/coil/i, 'Coil'],
  [/siku|angle/i, 'Profil Siku'],
  [/\bunp\b|channel|kanal/i, 'Profil UNP'],
  [/beam|\bwf\b|\biwf\b|\bhb\b/i, 'Beam'],
  [/flat/i, 'Flat Bar'],
  [/plate|\bplt\b|\bpl\b/i, 'Plate'],
  [/pipe|pipa/i, 'Pipe'],
  [/hollow/i, 'Hollow'],
  [/square|\bsq\b/i, 'Square Bar'],
  [/hex/i, 'Hex Bar'],
];

export function shapeInText(text: string): string {
  for (const [re, b] of SHAPE_WORDS) if (re.test(text)) return b;
  return '';
}

/** Nama material tanpa ukuran: buang angka, satuan, "x", "Dia", "OD", tanda baca di ujung. */
export function nameOf(uraian: string): string {
  const gm = gradeMatches(uraian);
  let t = ` ${uraian} `;
  gm.forEach((x, i) => {
    t = t.replace(x.raw, ` QGRADE${String.fromCharCode(97 + i)}Q `);
  });
  return t
    .replace(/(\d)\s*[x×*]\s*(?=\d)/gi, '$1 ')
    .replace(/\b(dia(meter)?|od|id|ø|l|p|t|tebal|panjang|lebar|uk(uran)?)\b\.?\s*(?=\d)/gi, ' ')
    .replace(/#/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(mm|cm|m|kg|pcs|pc|lbr|lembar|btg|batang|mtr|meter)?(?![a-z])/gi, ' ')
    // sisa kode ukuran yang menempel angka: 12T, 16W, 100L, 6M ...
    .replace(/(?<![a-z])\d[\w.,]*/gi, ' ')
    .replace(/(^|\s)[x×*](?=\s|$)/gi, ' ')
    .replace(/[,;:()[\]]+/g, ' ')
    .replace(/QGRADE([a-z])Q/g, (_m, c: string) => gm[c.charCodeAt(0) - 97]?.g || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/.-]+|[\s/.-]+$/g, '')
    .trim();
}

function top(m: Map<string, number>): string {
  let best = '';
  let n = 0;
  m.forEach((v, k) => {
    if (k && v > n) {
      n = v;
      best = k;
    }
  });
  return best;
}

/** Bangun kamus dari semua material yang pernah diinput. */
export function buildLexicon(entries: LexEntry[], limits = { grades: 300, names: 600 }): MaterialLexicon {
  type G = { spell: Map<string, number>; n: number; bentuk: Map<string, number>; line: Map<string, number> };
  type N = G & { grade: Map<string, number> };
  const grades = new Map<string, G>();
  const names = new Map<string, N>();
  const bump = (m: Map<string, number>, k: string) => {
    if (k) m.set(k, (m.get(k) || 0) + 1);
  };

  for (const e of entries) {
    const uraian = String(e.uraian || '').trim();
    if (!uraian && !e.grade) continue;
    const line = normalizeLine(String(e.line || '')).split(/\s*,\s*/)[0] || '';
    const bentuk = e.bentuk && e.bentuk !== 'Lainnya' && SHAPE_NAMES.includes(e.bentuk) ? e.bentuk : shapeInText(uraian);
    const gs = [String(e.grade || '').trim(), ...gradesInText(uraian)].filter(Boolean);
    const seen = new Set<string>();
    for (const g of gs) {
      const k = gradeKey(g);
      if (k.length < 3 || seen.has(k)) continue;
      seen.add(k);
      const x = grades.get(k) || { spell: new Map(), n: 0, bentuk: new Map(), line: new Map() };
      x.n += 1;
      bump(x.spell, g.replace(/\s+/g, ' '));
      bump(x.bentuk, bentuk);
      bump(x.line, line);
      grades.set(k, x);
    }
    const nm = nameOf(uraian);
    // Nama yang isinya hanya grade (mis. "HQ 705") tidak dijadikan nama material.
    if (nm.length >= 4 && /[a-z]/i.test(nm) && !gs.some((g) => gradeKey(g) === gradeKey(nm))) {
      const k = nm.toLowerCase();
      const x = names.get(k) || { spell: new Map(), n: 0, bentuk: new Map(), grade: new Map(), line: new Map() };
      x.n += 1;
      bump(x.spell, nm);
      bump(x.bentuk, bentuk);
      bump(x.grade, gs[0] || '');
      bump(x.line, line);
      names.set(k, x);
    }
  }

  return {
    grades: [...grades.values()]
      .map((x) => ({ g: top(x.spell), n: x.n, bentuk: top(x.bentuk), line: top(x.line) }))
      .sort((a, b) => b.n - a.n || a.g.localeCompare(b.g))
      .slice(0, limits.grades),
    names: [...names.values()]
      .map((x) => ({ t: top(x.spell), n: x.n, bentuk: top(x.bentuk), grade: top(x.grade), line: top(x.line) }))
      .sort((a, b) => b.n - a.n || a.t.localeCompare(b.t))
      .slice(0, limits.names),
  };
}

/** Daftar grade untuk saran: hasil belajar dulu (paling sering), lalu daftar bawaan. */
export function gradeOptions(lex: MaterialLexicon): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of [...lex.grades.map((x) => x.g), ...GRADE_SUGGESTIONS]) {
    const k = gradeKey(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}

/** Grade yang dikenal (dipelajari / bawaan) dengan ejaan bakunya. */
export function findGrade(lex: MaterialLexicon, typed: string): LexGrade | null {
  const k = gradeKey(typed);
  if (!k) return null;
  const hit = lex.grades.find((x) => gradeKey(x.g) === k);
  if (hit) return hit;
  const b = GRADE_SUGGESTIONS.find((g) => gradeKey(g) === k);
  return b ? { g: b, n: 0, bentuk: '', line: '' } : null;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flexRe = (g: string) => new RegExp(`(?<![a-z0-9])${g.replace(/[\s\-_./]/g, '').split('').map(escRe).join('[\\s\\-_./]*')}(?![a-z0-9])`, 'i');

/**
 * Baca teks material dengan bantuan kamus: grade yang pernah dipakai dikenali
 * (termasuk yang tidak ada di daftar bawaan, mis. "Creusabro 4800", "HQ 709"),
 * dan bila bentuk / Line tidak tertulis, diambil dari kebiasaan grade atau
 * nama material itu.
 */
export function parseWithLexicon(
  text: string,
  lex: MaterialLexicon,
  parse: (t: string) => { bentuk: string; grade: string; dim: Record<string, string | undefined>; pcs: string },
): { bentuk: string; grade: string; dim: Record<string, string | undefined>; pcs: string; line: string; known: boolean } {
  let rest = ` ${String(text || '')} `;
  let grade = '';
  let learned: LexGrade | null = null;
  // Grade yang dipelajari: yang terpanjang lebih dulu ("Creusabro 4800" sebelum "Creusabro").
  for (const x of [...lex.grades].sort((a, b) => gradeKey(b.g).length - gradeKey(a.g).length)) {
    const re = flexRe(x.g);
    if (gradeKey(x.g).length >= 3 && re.test(rest)) {
      grade = x.g;
      learned = x;
      rest = rest.replace(re, ' ');
      break;
    }
  }
  if (!grade) {
    const m = gradeMatches(rest)[0];
    if (m) {
      grade = findGrade(lex, m.g)?.g || m.g;
      learned = findGrade(lex, m.g);
      rest = rest.replace(m.raw, ' ');
    }
  }
  const p = parse(rest);
  if (!grade) grade = p.grade;
  let bentuk = p.bentuk;
  let line = '';
  const nm = nameOf(text).toLowerCase();
  const name = nm ? lex.names.find((x) => x.t.toLowerCase() === nm) : undefined;
  if (bentuk === 'Lainnya') bentuk = (learned?.bentuk || name?.bentuk || 'Lainnya') as string;
  line = learned?.line || name?.line || '';
  let dim = p.dim;
  // Bentuk dari kamus: baca ulang ukurannya dengan bentuk itu.
  if (bentuk !== p.bentuk && bentuk !== 'Lainnya') {
    const kw: Record<string, string> = { 'Round Bar': 'round bar', Plate: 'plate', 'Flat Bar': 'flat', Pipe: 'pipe', Hollow: 'hollow', 'Square Bar': 'square', 'Hex Bar': 'hex', Beam: 'beam', 'Profil Siku': 'siku', 'Profil UNP': 'unp', Coil: 'coil', 'Wire Mesh': 'wire mesh' };
    dim = parse(`${kw[bentuk] || ''} ${rest}`).dim;
  }
  return { bentuk, grade, dim, pcs: p.pcs, line, known: !!learned || !!name };
}
