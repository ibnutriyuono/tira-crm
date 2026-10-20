import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { buildProfileIndex, segmentBenchmarks } from '@/lib/customer-profile';
import type { PipelineIssue } from '@/lib/issues';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import type { Customer, CustomerGroup, Prospect, SalesActivity } from '@/lib/types';

const MIN_SEGMENT = 3;

/** Tanggal hari ini di Asia/Jakarta (YYYY-MM-DD). */
function jakartaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Rata-rata per segmen customer dari seluruh data nasional, TANPA nama
 * customer — pembanding segmen di Profil Customer. Data mentah tetap
 * mengikuti cakupan role di endpoint lain; yang keluar dari sini hanya
 * agregat (rata-rata metrik & persentase pembeli per produk).
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'customer', 'v');
  if (denied) {
    const denied2 = await guard(user, 'marketing', 'v');
    if (denied2) return denied2;
  }
  const [prospects, customers, groups, activities, issues] = await Promise.all([
    prisma.prospect.findMany(),
    prisma.customer.findMany(),
    prisma.customerGroup.findMany({ select: { id: true, segmen: true, entities: true, tier: true, name: true } }),
    prisma.salesActivity.findMany({ select: { id: true, tanggal: true, se: true, tipe: true, customer: true, status: true, pics: true } }),
    prisma.prospectIssue.findMany({ select: { id: true, prospectId: true, status: true, customer: true, kategori: true, targetDate: true } }),
  ]);
  // JSON round-trip: tanggal Prisma (Date) menjadi string ISO seperti di klien.
  const plain = <T,>(v: unknown) => JSON.parse(JSON.stringify(v)) as T;
  const index = buildProfileIndex({
    prospects: plain<Prospect[]>(prospects),
    customers: plain<Customer[]>(customers),
    groups: plain<CustomerGroup[]>(groups),
    activities: plain<SalesActivity[]>(activities),
    issues: plain<PipelineIssue[]>(issues),
    today: jakartaToday(),
  });
  // Segmen < 3 customer tidak dikirim: rata-ratanya sama saja dengan angka
  // satu-dua customer tertentu.
  return NextResponse.json({ benchmarks: segmentBenchmarks(index).filter((b) => b.n >= MIN_SEGMENT) });
}
