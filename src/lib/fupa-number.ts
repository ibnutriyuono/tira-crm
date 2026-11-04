import { prisma } from './prisma';

/**
 * Nomor FUP A otomatis: FUPA/<CABANG>/<TAHUN>/<urut 3 digit>, urut per cabang
 * per tahun. Dipakai bila nomor dikosongkan saat FUP A disimpan / SPP diunduh.
 */
export async function nextFupaNo(cabang: string | null | undefined, tgl: string | null | undefined): Promise<string> {
  const cab = (cabang || 'XX').trim().toUpperCase() || 'XX';
  const year = /^\d{4}/.test(tgl || '') ? String(tgl).slice(0, 4) : String(new Date().getFullYear());
  const prefix = `FUPA/${cab}/${year}/`;
  const rows = (await prisma.fupa.findMany({ where: { noFupa: { startsWith: prefix } }, select: { noFupa: true } })) as { noFupa: string | null }[];
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.noFupa).slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
