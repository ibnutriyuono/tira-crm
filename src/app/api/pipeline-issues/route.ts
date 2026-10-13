import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prospectScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { SARAN_META, issueCatLabel, issueInputError, urgensiLabel, type PipelineIssue } from '@/lib/issues';
import { bmsOf, canPropose, canReport, cleanPjIds, existingUserIds, issueScopeWhere, issueSnapshot, notifyIssue, pjText, postSystemMessage, salesOf } from '@/lib/issues-server';

/**
 * Masalah pipeline yang boleh dilihat user: semua yang aktif, ditambah yang
 * selesai/ditolak 12 bulan terakhir dan saran yang diabaikan 60 hari terakhir.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'masalah', 'v');
  if (denied) return denied;
  const since = new Date(Date.now() - 365 * 86400000);
  const sinceMuted = new Date(Date.now() - 60 * 86400000);
  const issues = await prisma.prospectIssue.findMany({
    where: {
      AND: [
        issueScopeWhere(user),
        {
          OR: [
            { status: { in: ['usulan', 'open', 'proses'] } },
            { status: { in: ['selesai', 'ditolak'] }, updatedAt: { gte: since } },
            { status: 'diabaikan', createdAt: { gte: sinceMuted } },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ issues });
}

/**
 * mode "lapor"   — BM cabang prospek membuat laporan resmi (status open);
 * mode "usulan"  — Sales pemilik prospek mengajukan ke BM;
 * mode "abaikan" — saran otomatis diabaikan (tidak muncul lagi 30 hari).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'masalah', 'e');
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const mode = String(b.mode || '');
  if (!['lapor', 'usulan', 'abaikan'].includes(mode)) return NextResponse.json({ error: 'Mode tidak valid' }, { status: 400 });

  const prospect = await prisma.prospect.findFirst({ where: { AND: [prospectScopeWhere(user), { id: String(b.prospectId || '') }] } });
  if (!prospect) return NextResponse.json({ error: 'Prospek tidak ditemukan' }, { status: 404 });
  const p = prospect as unknown as { id: string; se: string | null; cabang: string | null; reg: number | null; customer: string; status: number };
  const isReporter = canReport(user, p);
  const saran = b.saran && SARAN_META[String(b.saran)] ? String(b.saran) : null;

  if (mode === 'abaikan') {
    if (!saran) return NextResponse.json({ error: 'Saran tidak valid' }, { status: 400 });
    if (!isReporter && !canPropose(user, p)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
    const issue = await prisma.prospectIssue.create({
      data: { ...issueSnapshot(p), status: 'diabaikan', kategori: SARAN_META[saran].kategori, saran, keterangan: 'Saran diabaikan', dilaporOleh: user.id, dilaporNama: user.name },
    });
    emitCrmEvent('issue:updated', issue);
    return NextResponse.json({ issue }, { status: 201 });
  }

  if (mode === 'lapor' && !isReporter) return NextResponse.json({ error: 'Laporan masalah dibuat oleh BM cabang prospek. Sales: ajukan ke BM.' }, { status: 403 });
  if (mode === 'usulan' && !canPropose(user, p)) return NextResponse.json({ error: 'Hanya Sales pemilik prospek yang dapat mengajukan masalah ke BM.' }, { status: 403 });
  if (Number(p.status) < 1 || Number(p.status) > 5) return NextResponse.json({ error: 'Masalah hanya untuk prospek yang masih berjalan.' }, { status: 400 });

  const active = await prisma.prospectIssue.findFirst({ where: { prospectId: p.id, status: { in: ['usulan', 'open', 'proses'] } } });
  if (active) return NextResponse.json({ error: 'Prospek ini sudah punya masalah aktif — lanjutkan lewat diskusi kartu.' }, { status: 409 });

  const pjIds = mode === 'lapor' ? await existingUserIds(cleanPjIds(b.pjIds)) : [];
  const err = issueInputError(b, mode === 'lapor', pjIds);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const base = {
    ...issueSnapshot(p),
    kategori: String(b.kategori),
    urgensi: String(b.urgensi || 'sedang'),
    keterangan: String(b.keterangan).trim().slice(0, 2000),
    targetDate: b.targetDate ? String(b.targetDate) : null,
    saran,
  };
  const issue = (await prisma.prospectIssue.create({
    data:
      mode === 'lapor'
        ? { ...base, status: 'open', pjIds, dilaporOleh: user.id, dilaporNama: user.name, dilaporAt: new Date() }
        : { ...base, status: 'usulan', pjIds: [], diajukanOleh: user.id, diajukanNama: user.name },
  })) as unknown as PipelineIssue;
  emitCrmEvent('issue:updated', issue);

  const cat = issueCatLabel(issue.kategori);
  if (mode === 'lapor') {
    const pjs = await pjText(pjIds);
    await postSystemMessage(p.id, `⚑ Masalah dilaporkan (${user.name}): ${cat} · urgensi ${urgensiLabel(issue.urgensi)} — PJ: ${pjs}. ${issue.keterangan}`);
    await notifyIssue(issue, [...pjIds, ...(await salesOf(p.se))], user, 'issue_new', `⚑ Masalah baru: ${p.customer}`, `${cat} · urgensi ${urgensiLabel(issue.urgensi)} · PJ: ${pjs}. ${issue.keterangan}`);
  } else {
    await postSystemMessage(p.id, `⚑ Diajukan ke BM (${user.name}): ${cat}. ${issue.keterangan}`);
    await notifyIssue(issue, await bmsOf(p.cabang), user, 'issue_proposed', `⚑ Usulan masalah dari ${user.name}: ${p.customer}`, `${cat}. ${issue.keterangan}`);
  }
  await logActivity({ user, action: 'create', entity: 'prospect', entityId: p.id, summary: `${mode === 'lapor' ? 'Melaporkan' : 'Mengajukan'} masalah pipeline "${cat}" untuk ${p.customer}` });
  return NextResponse.json({ issue }, { status: 201 });
}
