import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prospectScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { PURCH_ISSUE_CATS, SARAN_META, issueCatLabel, issueInputError, urgensiLabel, type PipelineIssue } from '@/lib/issues';
import { isPurchasingRole } from '@/lib/auth';
import { itemsHaveLine } from '@/lib/doc-lines';
import type { SafeUser } from '@/lib/types';
import { bmsOf, canPropose, canReport, cleanPjIds, existingUserIds, issueScopeWhere, issueSnapshot, notifyIssue, pjText, postSystemMessage, salesOf } from '@/lib/issues-server';
import { opsLeadIds } from '@/lib/notify';

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
  if (mode === 'purch') return purchReport(user, b);
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

/**
 * mode "purch" — Purchasing melaporkan masalah dari detail RFQ / FUP A atau
 * item PO Indent. Masuk sebagai USULAN ke GM Operation (menunjuk PJ atau
 * menolak); Sales pemilik prospek diberi tahu. RFQ tanpa prospek tetap
 * bisa dilaporkan, diskusinya di thread RFQ.
 */
async function purchReport(user: SafeUser, b: Record<string, unknown>) {
  if (!isPurchasingRole(user.role) && user.role !== 'admin') return NextResponse.json({ error: 'Hanya Purchasing.' }, { status: 403 });
  const kategori = String(b.kategori || '');
  if (!PURCH_ISSUE_CATS.some((c) => c.key === kategori)) return NextResponse.json({ error: 'Pilih kategori masalah.' }, { status: 400 });
  const ket = String(b.keterangan || '').trim();
  if (ket.length < 10) return NextResponse.json({ error: 'Isi uraian masalah (min. 10 karakter).' }, { status: 400 });
  const solusi = String(b.solusi || '').trim().slice(0, 500);
  const itemsTxt = (Array.isArray(b.items) ? b.items : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  const urgensi = ['tinggi', 'sedang', 'rendah'].includes(String(b.urgensi)) ? String(b.urgensi) : 'sedang';

  let docJenis: 'rfq' | 'fupa' | 'po' = 'rfq';
  let docId = '';
  let noDoc = '';
  let cabang: string | null = null;
  let customer = '';
  let prospectId: string | null = null;
  if (b.rfqId) {
    const d = await prisma.rfq.findUnique({ where: { id: String(b.rfqId) } });
    if (!d) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });
    if (user.role === 'purchasing05' && !itemsHaveLine(d.items)) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });
    docJenis = 'rfq';
    docId = d.id;
    noDoc = d.noRfq || 'RFQ';
    cabang = d.cabang;
    customer = d.customer || '';
    prospectId = d.prospectId;
  } else if (b.fupaId) {
    const d = await prisma.fupa.findUnique({ where: { id: String(b.fupaId) } });
    if (!d) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });
    if (user.role === 'purchasing05' && !itemsHaveLine(d.items)) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });
    docJenis = 'fupa';
    docId = d.id;
    noDoc = d.noFupa || 'FUP A';
    cabang = d.cabang;
    customer = d.customer || '';
    prospectId = d.prospectId;
  } else if (b.prospectId) {
    docJenis = 'po';
    prospectId = String(b.prospectId);
  } else return NextResponse.json({ error: 'Dokumen wajib.' }, { status: 400 });

  const p = prospectId ? await prisma.prospect.findUnique({ where: { id: prospectId } }) : null;
  if (docJenis === 'po') {
    if (!p) return NextResponse.json({ error: 'PO tidak ditemukan' }, { status: 404 });
    docId = p.id;
    noDoc = p.noPo || 'PO';
  }
  const active = p ? await prisma.prospectIssue.findFirst({ where: { prospectId: p.id, status: { in: ['usulan', 'open', 'proses'] } } }) : null;
  if (active) return NextResponse.json({ error: 'Prospek ini sudah punya masalah aktif — lanjutkan lewat diskusi masalah itu.', issueId: active.id }, { status: 409 });
  const snap = p
    ? issueSnapshot(p as unknown as { id: string; se: string | null; cabang: string | null; reg: number | null; customer: string; status: number })
    : { prospectId: `doc:${docJenis}:${docId}`, se: null, cabang, reg: null, customer: customer || noDoc };
  if (!snap.cabang) return NextResponse.json({ error: 'Cabang dokumen tidak diketahui.' }, { status: 400 });

  const keterangan = [`[${noDoc}] ${ket}`, itemsTxt.length ? `Item: ${itemsTxt.join('; ')}` : '', solusi ? `Usulan solusi: ${solusi}` : ''].filter(Boolean).join('\n').slice(0, 2000);
  const issue = (await prisma.prospectIssue.create({
    data: {
      ...snap,
      status: 'usulan',
      kategori,
      urgensi,
      keterangan,
      pjIds: [],
      diajukanOleh: user.id,
      diajukanNama: user.name,
      sumber: 'purchasing',
      docJenis,
      docId,
      noDoc,
    },
  })) as unknown as PipelineIssue;
  emitCrmEvent('issue:updated', issue);
  const cat = issueCatLabel(kategori);
  await postSystemMessage(issue.prospectId, `⚑ Purchasing (${user.name}) melaporkan masalah ${noDoc}: ${cat}. ${ket}`);
  await notifyIssue(issue, await opsLeadIds(), user, 'issue_proposed', `⚑ Laporan Purchasing: ${snap.customer}`, `${noDoc} · ${cat}. ${ket}`);
  if (snap.se) await notifyIssue(issue, await salesOf(snap.se), user, 'issue_update', `⚑ Purchasing melaporkan masalah: ${snap.customer}`, `${noDoc} · ${cat}. ${ket}`);
  await logActivity({ user, action: 'create', entity: docJenis === 'po' ? 'prospect' : docJenis, entityId: docId, summary: `Purchasing melaporkan masalah "${cat}" pada ${noDoc}` });
  return NextResponse.json({ issue }, { status: 201 });
}
