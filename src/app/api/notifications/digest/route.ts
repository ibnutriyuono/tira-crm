import { NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/email-notify';
import { sweepFollowUpNotifications } from '@/lib/followup-notify';
import { sweepIssueEscalation } from '@/lib/issues-server';
import { sweepOpsEscalation } from '@/lib/ops-escalation';

/**
 * Dipanggil penjadwal di server.js tiap 5 menit (header x-cron-key =
 * CRON_SECRET, atau JWT_SECRET bila CRON_SECRET kosong): jalankan pengecekan
 * follow-up & eskalasi masalah (supaya tetap jalan walau tidak ada yang membuka
 * CRM), lalu kirim ringkasan harian yang jatuh tempo.
 */
export async function POST(req: Request) {
  const key = process.env.CRON_SECRET || process.env.JWT_SECRET || '';
  if (!key || req.headers.get('x-cron-key') !== key) return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 401 });
  await sweepFollowUpNotifications();
  await sweepIssueEscalation();
  await sweepOpsEscalation();
  const result = await runDailyDigest();
  return NextResponse.json(result);
}
