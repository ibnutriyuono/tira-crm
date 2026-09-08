/**
 * Cek (dan opsional perbaiki) No. RFQ yang duplikat SEBELUM menjalankan
 * migrasi unique index pada Rfq.noRfq.
 *
 * Kenapa perlu: `prisma migrate` akan GAGAL membuat unique index kalau di
 * tabel sudah ada dua baris dengan noRfq sama. Kegagalannya di tengah
 * migrasi, jadi lebih baik diketahui dan dibereskan lebih dulu.
 *
 *   Lihat saja (tidak mengubah apa pun):
 *     npx tsx prisma/check-duplicate-rfq.ts
 *
 *   Perbaiki otomatis (menambahkan sufiks -2, -3, ... pada duplikatnya,
 *   baris tertua dibiarkan memakai nomor aslinya):
 *     npx tsx prisma/check-duplicate-rfq.ts --fix
 *
 * NULL tidak masalah: Postgres mengizinkan banyak NULL pada unique index,
 * jadi RFQ lama yang belum bernomor tidak perlu disentuh.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIX = process.argv.includes('--fix');

async function main() {
  const semua = await prisma.rfq.findMany({
    where: { noRfq: { not: null } },
    select: { id: true, noRfq: true, customer: true, cabang: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const perNomor = new Map<string, typeof semua>();
  for (const r of semua) {
    const key = r.noRfq as string;
    if (!perNomor.has(key)) perNomor.set(key, []);
    perNomor.get(key)!.push(r);
  }
  const duplikat = Array.from(perNomor.entries()).filter(([, rows]) => rows.length > 1);

  if (duplikat.length === 0) {
    console.log(`OK - ${semua.length} RFQ bernomor, tidak ada duplikat. Migrasi unique index aman dijalankan.`);
    return;
  }

  console.log(`Ditemukan ${duplikat.length} nomor RFQ yang dipakai lebih dari satu baris:\n`);
  for (const [nomor, rows] of duplikat) {
    console.log(`  "${nomor}" dipakai ${rows.length} RFQ:`);
    rows.forEach((r, i) => {
      const tanda = i === 0 ? 'dipertahankan' : FIX ? `diubah jadi "${nomor}-${i + 1}"` : 'perlu diubah';
      console.log(`    - ${r.cabang || '-'} / ${r.customer || '-'} (${r.createdAt.toISOString().slice(0, 10)}) - ${tanda}`);
    });
  }

  if (!FIX) {
    console.log(`\nJalankan ulang dengan --fix untuk menambahkan sufiks pada duplikatnya,`);
    console.log(`atau perbaiki manual lewat aplikasi, baru jalankan prisma migrate.`);
    process.exitCode = 1;
    return;
  }

  let diubah = 0;
  for (const [nomor, rows] of duplikat) {
    // Baris pertama (tertua) tetap memakai nomor aslinya; sisanya diberi
    // sufiks. Sufiks dicek dulu supaya tidak menabrak nomor yang sudah ada.
    for (let i = 1; i < rows.length; i++) {
      let n = i + 1;
      let kandidat = `${nomor}-${n}`;
      while (await prisma.rfq.findFirst({ where: { noRfq: kandidat }, select: { id: true } })) {
        n++;
        kandidat = `${nomor}-${n}`;
      }
      await prisma.rfq.update({ where: { id: rows[i].id }, data: { noRfq: kandidat } });
      diubah++;
    }
  }
  console.log(`\nSelesai - ${diubah} nomor diubah. Sekarang aman menjalankan prisma migrate.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
