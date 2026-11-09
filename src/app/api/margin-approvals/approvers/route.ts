import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap } from '@/lib/auth';
import { marginApproversFor } from '@/lib/margin-server';
import { MARGIN_LEVEL_LABEL, type MarginLevel } from '@/lib/margin-tier';

/**
 * Siapa yang menyetujui diskon untuk satu cabang, per tingkat:
 *   GET ?cabang=CLG → { bm: [{ name, role }], gm: [...], vp: [...] }
 * Sama dengan penerima pengajuan (tingkat kosong → naik ke tingkat di atasnya).
 * Hanya nama & role — tanpa kontak.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const cabang = (new URL(req.url).searchParams.get('cabang') || user.cabang || '').trim().toUpperCase() || null;
  const regMap = await cabangRegMap();
  const reg = cabang ? (regMap[cabang] ?? null) : null;
  const out: Record<string, { name: string; role: string; label: string }[]> = {};
  for (const l of ['bm', 'gm', 'vp'] as MarginLevel[]) {
    const rows = await marginApproversFor(l, { cabang, reg });
    out[l] = rows.map((r) => ({ name: r.name, role: r.role, label: MARGIN_LEVEL_LABEL[r.role as MarginLevel] || (r.role === 'admin' ? 'Admin' : r.role.toUpperCase()) }));
  }
  return NextResponse.json(out);
}
