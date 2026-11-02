import { prisma } from './prisma';
import { prospectScopeWhere } from './auth';
import { notify } from './notify';
import { logActivity } from './activity';
import { getProspectMaterials } from './format';
import { DUP_WINDOW_DAYS, findDuplicates, type DupDraft, type DupView } from './prospect-duplicates';
export type { DupView };
import type { Prospect, SafeUser } from './types';

/**
 * Cari prospek mirip di SELURUH database (bukan hanya wilayah user) — justru
 * kasus terpenting adalah dua SE / dua cabang mengejar permintaan yang sama.
 * Prospek di luar wilayah ditampilkan terbatas: cabang, SE, tahap, tanggal —
 * tanpa nilai, dan tanpa nama customer bila customer-nya berbeda.
 */
export async function findDuplicatesFor(user: SafeUser, draft: DupDraft): Promise<{ views: DupView[]; raw: ReturnType<typeof findDuplicates> }> {
  const since = new Date(Date.now() - (DUP_WINDOW_DAYS + 1) * 86400000);
  const candidates = (await prisma.prospect.findMany({
    where: { status: { gte: 1, lte: 5 }, OR: [{ createdAt: { gte: since } }, { tglPenawaran: { gte: since.toISOString().slice(0, 10) } }] },
    select: { id: true, customer: true, cabang: true, se: true, status: true, value: true, tglPenawaran: true, createdAt: true, materials: true, qty: true, line: true, uraian: true },
  })) as unknown as Prospect[];
  const raw = findDuplicates(
    draft,
    candidates.map((c) => ({ ...c, createdAt: new Date(c.createdAt as unknown as string).toISOString() })),
  );
  if (!raw.length) return { views: [], raw };
  const inScopeIds = new Set(
    (await prisma.prospect.findMany({ where: { AND: [prospectScopeWhere(user), { id: { in: raw.map((m) => m.prospect.id) } }] }, select: { id: true } })).map((r) => r.id),
  );
  const views = raw.map<DupView>((m) => {
    const inScope = inScopeIds.has(m.prospect.id);
    return {
      id: inScope ? m.prospect.id : null,
      customer: inScope || m.sameCustomer ? m.prospect.customer : null,
      cabang: m.prospect.cabang,
      se: m.prospect.se,
      status: Number(m.prospect.status),
      tgl: (m.prospect.tglPenawaran || String(m.prospect.createdAt || '')).slice(0, 10) || null,
      value: inScope ? Number(m.prospect.value) : null,
      sameCustomer: m.sameCustomer,
      kind: m.kind,
      matched: m.matched,
      total: m.total,
      otherTotal: m.otherTotal,
      items: m.items,
      inScope,
    };
  });
  return { views, raw };
}

/**
 * Prospek tetap disimpan walau mirip prospek SE lain: catat dan beri tahu BM
 * cabang-cabang yang terlibat (dan RM bila lintas regional tidak perlu —
 * cukup BM), supaya bisa diputuskan siapa yang menangani.
 */
export async function notifyDuplicateSaved(user: SafeUser, saved: Pick<Prospect, 'id' | 'customer' | 'cabang' | 'se'>, raw: ReturnType<typeof findDuplicates>): Promise<void> {
  try {
    const others = raw.filter((m) => (m.prospect.se || '').toUpperCase() !== (saved.se || '').toUpperCase());
    if (!others.length) return;
    const cabangs = Array.from(new Set([saved.cabang, ...others.map((m) => m.prospect.cabang)].map((c) => (c || '').trim().toUpperCase()).filter(Boolean)));
    const bms = await prisma.user.findMany({ where: { role: 'bm', cabang: { in: cabangs, mode: 'insensitive' } }, select: { id: true } });
    const list = others
      .slice(0, 3)
      .map((m) => `${m.prospect.cabang || '-'}/${m.prospect.se || '-'}${m.sameCustomer ? '' : ` (${m.prospect.customer})`}`)
      .join(', ');
    await notify({
      userIds: bms.map((b) => b.id).filter((id) => id !== user.id),
      type: 'prospect_duplicate',
      entity: 'prospect',
      entityId: saved.id,
      title: `Prospek mirip: ${saved.customer} (${saved.cabang || '-'}/${saved.se || '-'})`,
      message: `${user.name} menyimpan prospek ${saved.customer} walau material & qty-nya sama dengan prospek ${list}. Pastikan tidak ada dua SE yang mengejar permintaan yang sama dengan harga berbeda.`,
    });
  } catch (err) {
    console.error('[dup] gagal mengirim notifikasi prospek mirip', err);
  }
}

/**
 * Dipanggil route simpan prospek: bila user menyimpan setelah melihat
 * peringatan (body.dupAck), hitung ulang di server, catat di Log Aktivitas,
 * dan beri tahu BM bila kemiripannya dengan prospek SE lain.
 */
export async function recordDuplicateAck(user: SafeUser, body: unknown, saved: Prospect): Promise<void> {
  if (!(body && typeof body === 'object' && (body as { dupAck?: unknown }).dupAck === true)) return;
  try {
    const { raw } = await findDuplicatesFor(user, { id: saved.id, customer: saved.customer, materials: getProspectMaterials(saved) });
    if (!raw.length) return;
    await logActivity({
      user,
      action: 'update',
      entity: 'prospect',
      entityId: saved.id,
      summary: `Menyimpan prospek "${saved.customer}" walau mirip ${raw.length} prospek lain (${raw
        .slice(0, 3)
        .map((m) => `${m.prospect.cabang || '-'}/${m.prospect.se || '-'}`)
        .join(', ')})`,
    });
    await notifyDuplicateSaved(user, saved, raw);
  } catch (err) {
    console.error('[dup] gagal mencatat prospek mirip', err);
  }
}
