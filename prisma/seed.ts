import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_USERS: { username: string; name: string; role: Role; se?: string; cabang?: string; reg?: number; password: string }[] = [
  { username: 'admin', name: 'Administrator', role: 'admin', password: 'admin123' },
  { username: 'gm', name: 'General Manager Demo', role: 'gm', password: 'gm123' },
  { username: 'rm', name: 'Regional Manager Demo', role: 'rm', reg: 2, password: 'rm123' },
  { username: 'bm', name: 'Branch Manager Demo', role: 'bm', cabang: 'DKI', password: 'bm123' },
  { username: 'sales', name: 'Sales Demo', role: 'sales', se: 'DEMO', cabang: 'DKI', password: 'sales123' },
];

// Same seed prospect rows as the original single-file app, so a fresh install
// starts with realistic pipeline data to demo the funnel/KPI/kanban views.
const SEED_PROSPECTS = [
  { reg: 2, cabang: 'DKI', se: 'TD', customer: 'SARWONO', phone: '', tglPenawaran: '2026-07-03', tglPO: '2026-07-24', tglDelivery: '2026-07-27', line: '04', uraian: 'Mn13 PLT 6 X 1000 X 2000 MM', qty: 2, value: 21120000, kondisiStock: 'READY STOCK', keterangan: 'DIAMBIL TGL 27 JULI 2026', status: 5 },
  { reg: 3, cabang: 'BLP', se: 'WI', customer: 'PT. OILFIELD SERVICES & SUPPLIES INDONESIA', phone: '', tglPenawaran: '', tglPO: '2026-06-02', tglDelivery: '2026-06-02', line: '02', uraian: 'Round Bar HQ 709 / AISI 4140 OD.60 X 320 MM', qty: 1, value: 464000, kondisiStock: 'READY STOCK BLP', keterangan: 'Tersupply', status: 5 },
  { reg: 1, cabang: 'MDN', se: 'ARH', customer: 'SYAUKATH GROUP', phone: '', tglPenawaran: '2025-10-02', tglPO: '', tglDelivery: '', line: '02', uraian: 'HQ 705 DIA 130 X 6000 MM', qty: 1, value: 39690000, kondisiStock: 'NO STOK', keterangan: 'Proses penawaran harga dengan Customer', status: 2 },
  { reg: 2, cabang: 'SBY', se: 'QQ', customer: 'BUMI SUKSESINDO', phone: '', tglPenawaran: '2026-07-24', tglPO: '', tglDelivery: '', line: '04', uraian: 'TW 450 PLT 16X1200x2400 MM,', qty: 4, value: 58058000, kondisiStock: '', keterangan: '', status: 2 },
  { reg: 2, cabang: 'CLG', se: 'SI', customer: 'MULTI CIPTA KREASI, PT', phone: '', tglPenawaran: '2026-02-25', tglPO: '', tglDelivery: '', line: '04', uraian: 'TC 4800 # 25 X 1500 X 3000 MM', qty: 1, value: 58500000, kondisiStock: 'Indent: 5-6 Bulan', keterangan: 'CLOSED. Kalah tender.', status: 6 },
  { reg: 3, cabang: 'BLP', se: 'SN', customer: 'PT. ZUAM MITRA BERSAUDARA', phone: '', tglPenawaran: '2026-05-13', tglPO: '', tglDelivery: '', line: '04', uraian: 'HB 450, 16 X 2500 X 6000 MM', qty: 6, value: 384336000, kondisiStock: 'READY STOCK JKT', keterangan: 'Lose order', status: 6 },
  { reg: 2, cabang: 'CLP', se: 'AM', customer: 'PUTERA JAYA TEKNIK, PT', phone: '', tglPenawaran: '2025-10-31', tglPO: '', tglDelivery: '', line: '03', uraian: 'SD 2205 PLT 10 x 1500 x 6000 MM', qty: 1, value: 180000000, kondisiStock: 'INDENT', keterangan: 'KALAH', status: 6 },
  { reg: 2, cabang: 'SBY', se: 'SG', customer: 'JAWA POWER', phone: '', tglPenawaran: '2026-04-29', tglPO: '', tglDelivery: '', line: '05', uraian: 'Journal Housing Liner for Journal Shaft, Material Abrex 400', qty: 6, value: 19800000, kondisiStock: 'DT. 1 Bulan', keterangan: 'Kalah harga tender', status: 6 },
  { reg: 2, cabang: 'SBY', se: 'SG', customer: 'JAWA POWER', phone: '', tglPenawaran: '2026-06-30', tglPO: '', tglDelivery: '', line: '05', uraian: 'Steel All Thread (Asdrat Grade) , M24, Black, Length : 1 Meter', qty: 5, value: 1275000, kondisiStock: '', keterangan: 'kalah harga', status: 6 },
  { reg: 2, cabang: 'DKI', se: 'TD', customer: 'TOSURO TECHNOLOGY INDONESIA', phone: '', tglPenawaran: '2026-07-05', tglPO: '2026-07-07', tglDelivery: '2026-07-08', line: '03', uraian: '2507W  DIA. 180 X 65 MM', qty: 1, value: 5875275, kondisiStock: 'READY STOCK', keterangan: 'DIAMBIL TGL 08 JULI 2026', status: 5 },
  { reg: 1, cabang: 'PKB', se: 'RM', customer: 'PT.Riau Jaya Konstruksi', phone: '', tglPenawaran: '2026-05-11', tglPO: '', tglDelivery: '', line: '02', uraian: 'Plate Wear Resistance T.10mm x 1500mm x 3000mm', qty: 1, value: 13140000, kondisiStock: 'READY STOCK', keterangan: 'Proses penawaran harga dengan Customer', status: 2 },
  { reg: 2, cabang: 'BDG', se: 'AM', customer: 'PT. REXLINE ENGINEERING INDONESIA', phone: '', tglPenawaran: '2026-06-30', tglPO: '', tglDelivery: '', line: '03', uraian: 'SF003 PLT 6 MM X 1500 X 6000', qty: 4, value: 81216000, kondisiStock: 'READY', keterangan: '', status: 2 },
  { reg: 1, cabang: 'PKB', se: 'RM', customer: 'PT. Agrinas Palma Nusantara', phone: '', tglPenawaran: '2026-05-11', tglPO: '', tglDelivery: '', line: '02', uraian: 'Rotor Bar HQ 705 Dia 20mm x 430mm', qty: 50, value: 3721000, kondisiStock: 'READY STOCK', keterangan: 'Proses penawaran harga dengan Customer', status: 2 },
  { reg: 3, cabang: 'BLP', se: 'SN', customer: 'PT. BUKIT MAKMUR MANDIRI UTAMA', phone: '', tglPenawaran: '', tglPO: '2026-06-17', tglDelivery: '2026-06-19', line: '04', uraian: 'PLATE,WEAR,HB400,12X2500X4000MM', qty: 1, value: 28523383, kondisiStock: 'READY STOCK BLP', keterangan: 'Tersupply', status: 5 },
  { reg: 1, cabang: 'PLB', se: 'TAD', customer: 'PT. Lontar Papyrus Pulp And Paper', phone: '', tglPenawaran: '2026-03-06', tglPO: '', tglDelivery: '', line: '05', uraian: 'PL.PLATE;FL,12T,0.56W,20L,CREUSABRO8000', qty: 40, value: 246200000, kondisiStock: 'Ready', keterangan: 'Proses penawaran harga dengan Customer', status: 4 },
  { reg: 1, cabang: 'PLB', se: 'TAD', customer: 'PT. Timah Tbk', phone: '', tglPenawaran: '2026-01-19', tglPO: '', tglDelivery: '', line: '02', uraian: 'BAR,METAL:HEX;32MM;DIN 17100 GR ST37.2', qty: 40, value: 73500000, kondisiStock: 'Indent', keterangan: 'Lose Order', status: 6 },
  { reg: 2, cabang: 'BDG', se: 'AM', customer: 'PT.ARIANTO DARMAWAN', phone: '', tglPenawaran: '2026-06-24', tglPO: '', tglDelivery: '', line: '04', uraian: 'TC 4800 PLT 06 MM X 2000 MM X 3000 MM', qty: 2, value: 31700000, kondisiStock: 'READY', keterangan: '', status: 2 },
  { reg: 1, cabang: 'PKB', se: 'RM', customer: 'PT. Mondan', phone: '', tglPenawaran: '2026-02-19', tglPO: '', tglDelivery: '', line: '02', uraian: 'PLATE SS SF 003 6MM X 1500MM X 6000MM', qty: 6, value: 89700000, kondisiStock: 'READY STOCK', keterangan: 'kalah harga', status: 6 },
];

async function main() {
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        name: u.name,
        role: u.role,
        se: u.se ?? null,
        cabang: u.cabang ?? null,
        reg: u.reg ?? null,
        passwordHash,
      },
    });
  }
  console.log(`Seeded ${DEMO_USERS.length} demo users.`);

  const existingProspects = await prisma.prospect.count();
  if (existingProspects === 0) {
    for (const p of SEED_PROSPECTS) {
      const materials = [{ line: p.line, uraian: p.uraian, qty: p.qty, harga: p.qty > 0 ? Math.round(p.value / p.qty) : p.value }];
      await prisma.prospect.create({
        data: {
          reg: p.reg,
          cabang: p.cabang,
          se: p.se,
          customer: p.customer,
          phone: p.phone,
          tglPenawaran: p.tglPenawaran || null,
          tglPO: p.tglPO || null,
          tglDelivery: p.tglDelivery || null,
          line: p.line,
          uraian: p.uraian,
          qty: p.qty,
          value: p.value,
          materials,
          kondisiStock: p.kondisiStock,
          keterangan: p.keterangan,
          status: p.status,
          penawaranTerkirim: p.status === 4 || p.status === 5,
        },
      });
    }
    console.log(`Seeded ${SEED_PROSPECTS.length} demo prospects.`);
  } else {
    console.log('Prospects already exist, skipping prospect seed.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
