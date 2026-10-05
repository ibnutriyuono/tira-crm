import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { logActivity } from './activity';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import type { CustomerPic, SafeUser } from './types';

export interface PicInput {
  nama: string;
  jabatan?: string | null;
}

const norm = (s: string | null | undefined) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Splits a free-text PIC field (Perjalanan Dinas) into people:
 * "Hendra (Purchasing Manager), Sari (QC)" -> [{Hendra, Purchasing Manager}, {Sari, QC}].
 * Separators are commas, semicolons, "&" or " dan " outside parentheses; a
 * name without "(...)" has no jabatan.
 */
export function parsePicText(text: string | null | undefined): PicInput[] {
  const src = (text || '').trim();
  if (!src) return [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    const rest = src.slice(i);
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '&' || /^ dan /i.test(rest))) {
      parts.push(cur);
      cur = '';
      if (/^ dan /i.test(rest)) i += 4;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      return m ? { nama: m[1].trim(), jabatan: m[2].trim() || null } : { nama: p, jabatan: null };
    })
    .filter((p) => p.nama.length > 0 && p.nama.length <= 120);
}

/**
 * Pure merge of incoming PICs into a customer's list. A PIC is the same
 * person when the name matches (case/space-insensitive). New names are
 * appended; an existing PIC with an empty jabatan gets the incoming one.
 * Existing data (jabatan, phone, email, primary) is never overwritten.
 * Returns null when nothing changed.
 */
export function mergePics(existing: CustomerPic[], incoming: PicInput[], newId: () => string = randomUUID): CustomerPic[] | null {
  const out = existing.map((p) => ({ ...p }));
  let changed = false;
  for (const inc of incoming) {
    const nama = (inc.nama || '').trim().replace(/\s+/g, ' ');
    if (!nama) continue;
    const jabatan = (inc.jabatan || '').trim() || null;
    const hit = out.find((p) => norm(p.nama) === norm(nama));
    if (hit) {
      if (!hit.jabatan && jabatan) {
        hit.jabatan = jabatan;
        changed = true;
      }
      continue;
    }
    out.push({ id: newId(), nama, jabatan, phone: null, email: null, isPrimary: out.length === 0 });
    changed = true;
  }
  return changed ? out : null;
}

/**
 * "Every form with a company name and a PIC feeds Kelola Customer":
 * - company not in Kelola Customer yet -> created with these PICs;
 * - company exists -> PICs it doesn't have yet are appended.
 * Matching is by company name, case/space-insensitive, across all branches
 * (one company is one customer record). Best-effort: a failure here is
 * logged and never fails the form save that triggered it.
 */
export async function syncCustomerPics(user: SafeUser, entries: { customer: string; pics: PicInput[]; cabang?: string | null }[], source: string): Promise<void> {
  // Group by company so one save touching the same customer twice writes once.
  const byName = new Map<string, { name: string; cabang: string; pics: PicInput[] }>();
  for (const e of entries) {
    const name = (e.customer || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 150) continue;
    const key = norm(name);
    const g = byName.get(key) || { name, cabang: (e.cabang || '').trim().toUpperCase(), pics: [] };
    g.pics.push(...e.pics);
    byName.set(key, g);
  }
  for (const g of byName.values()) {
    if (g.pics.every((p) => !(p.nama || '').trim())) continue;
    try {
      const existing = await prisma.customer.findFirst({ where: { name: { equals: g.name, mode: 'insensitive' } } });
      if (!existing) {
        const pics = mergePics([], g.pics) || [];
        if (pics.length === 0) continue;
        const primary = pics[0];
        const customer = await prisma.customer.create({
          data: {
            name: g.name,
            cabang: g.cabang,
            pic: primary.nama,
            phone: '',
            email: '',
            address: '',
            catatan: `Ditambahkan otomatis dari ${source}`,
            pics: pics as unknown as Prisma.InputJsonValue,
          },
        });
        emitCrmEvent('customer:created', customer);
        await logActivity({ user, action: 'create', entity: 'customer', entityId: customer.id, summary: `Customer "${g.name}" ditambahkan otomatis dari ${source} (${pics.length} PIC)` });
        continue;
      }
      const current = Array.isArray(existing.pics) ? (existing.pics as unknown as CustomerPic[]) : [];
      // A customer saved before multi-PIC has its only contact in the legacy
      // columns; seed the list from them so that contact isn't demoted.
      const seeded: CustomerPic[] =
        current.length === 0 && existing.pic
          ? [{ id: randomUUID(), nama: existing.pic, jabatan: null, phone: existing.phone || null, email: existing.email || null, isPrimary: true }]
          : current;
      const merged = mergePics(seeded, g.pics);
      if (!merged) continue;
      const primary = merged.find((p) => p.isPrimary) || merged[0];
      const customer = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          pics: merged as unknown as Prisma.InputJsonValue,
          pic: primary.nama,
          phone: primary.phone ?? existing.phone,
          email: primary.email ?? existing.email,
        },
      });
      emitCrmEvent('customer:updated', customer);
      const added = merged.length - seeded.length;
      await logActivity({
        user,
        action: 'update',
        entity: 'customer',
        entityId: customer.id,
        summary: added > 0 ? `${added} PIC baru ditambahkan otomatis ke "${customer.name}" dari ${source}` : `Jabatan PIC "${customer.name}" dilengkapi otomatis dari ${source}`,
      });
    } catch (err) {
      console.error('[customer-sync] gagal sinkron', g.name, err);
    }
  }
}
