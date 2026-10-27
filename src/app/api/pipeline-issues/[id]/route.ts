import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';
import { HASIL_META, URGENSI, issueCatLabel, issueInputError, urgensiLabel, type PipelineIssue } from '@/lib/issues';
import { canHandle, canReport, issueLeadIds, cleanPjIds, closeText, existingUserIds, notifyIssue, pjText, postSystemMessage, salesOf } from '@/lib/issues-server';

/**
 * Tindak lanjut satu masalah. action:
 *  - terima  (BM): usulan Sales -> laporan resmi (open), isi PJ & urgensi;
 *  - tolak   (BM): usulan ditolak, alasan wajib;
 *  - tangani (PJ / BM): open -> proses;
 *  - selesai (PJ / BM): solusi & hasil wajib;
 *  - ubah    (BM): ganti PJ / urgensi / target / keterangan.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'masalah', 'e');
  if (denied) return denied;
  const { id } = await params;
  const i = (await prisma.prospectIssue.findUnique({ where: { id } })) as unknown as PipelineIssue | null;
  if (!i) return NextResponse.json({ error: 'Masalah tidak ditemukan' }, { status: 404 });
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const action = String(b.action || '');
  const isBm = canReport(user, { cabang: i.cabang, sumber: i.sumber });
  const purch = i.sumber === 'purchasing';
  const leadLabel = purch ? 'GM Operation' : 'BM cabang';
  const cat = issueCatLabel(i.kategori);
  const sales = await salesOf(i.se);
  let data: Record<string, unknown> = {};
  let sys = '';
  let notifyTo: string[] = [];
  let title = '';
  let msg = '';
  let type: 'issue_new' | 'issue_update' = 'issue_update';

  if (action === 'terima' || action === 'tolak') {
    if (!isBm) return NextResponse.json({ error: `Hanya ${leadLabel} yang memproses usulan masalah ini.` }, { status: 403 });
    if (i.status !== 'usulan') return NextResponse.json({ error: 'Usulan ini sudah diproses.' }, { status: 409 });
    if (action === 'tolak') {
      const alasan = String(b.alasan || '').trim();
      if (alasan.length < 5) return NextResponse.json({ error: 'Tulis alasan penolakan.' }, { status: 400 });
      data = { status: 'ditolak', alasanTolak: alasan.slice(0, 500), dilaporOleh: user.id, dilaporNama: user.name };
      sys = `✕ Usulan masalah ditolak ${purch ? 'GM Operation' : 'BM'} (${user.name}): ${alasan}`;
      notifyTo = i.diajukanOleh ? [i.diajukanOleh] : sales;
      title = `Usulan masalah ditolak: ${i.customer}`;
      msg = `${cat} — ${alasan}`;
    } else {
      const pjIds = await existingUserIds(cleanPjIds(b.pjIds));
      const merged = { kategori: b.kategori ?? i.kategori, keterangan: b.keterangan ?? i.keterangan, urgensi: b.urgensi ?? i.urgensi, targetDate: b.targetDate ?? i.targetDate };
      const err = issueInputError(merged, true, pjIds);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      data = {
        status: 'open',
        kategori: String(merged.kategori),
        keterangan: String(merged.keterangan).trim().slice(0, 2000),
        urgensi: String(merged.urgensi || 'sedang'),
        targetDate: merged.targetDate ? String(merged.targetDate) : null,
        pjIds,
        dilaporOleh: user.id,
        dilaporNama: user.name,
        dilaporAt: new Date(),
      };
      const pjs = await pjText(pjIds);
      sys = `⚑ Masalah dilaporkan ${purch ? 'GM Operation' : 'BM'} (${user.name}) dari usulan ${i.diajukanNama || 'Sales'}: ${issueCatLabel(String(merged.kategori))} · urgensi ${urgensiLabel(String(merged.urgensi))} — PJ: ${pjs}`;
      notifyTo = [...pjIds, ...(i.diajukanOleh ? [i.diajukanOleh] : sales)];
      type = 'issue_new';
      title = `⚑ Masalah baru: ${i.customer}`;
      msg = `${issueCatLabel(String(merged.kategori))} · PJ: ${pjs}. ${String(merged.keterangan)}`;
    }
  } else if (action === 'tangani') {
    if (!canHandle(user, i)) return NextResponse.json({ error: `Hanya penanggung jawab atau ${leadLabel} yang menangani masalah ini.` }, { status: 403 });
    if (i.status !== 'open') return NextResponse.json({ error: 'Masalah ini tidak berstatus Terbuka.' }, { status: 409 });
    data = { status: 'proses', ditanganiAt: new Date(), ditanganiNama: user.name };
    sys = `Status → Ditangani (${user.name})`;
    notifyTo = [...sales, ...(await issueLeadIds(i)), ...i.pjIds];
    title = `Masalah ditangani: ${i.customer}`;
    msg = `${cat} — ditangani ${user.name}.`;
  } else if (action === 'selesai') {
    if (!canHandle(user, i)) return NextResponse.json({ error: `Hanya penanggung jawab atau ${leadLabel} yang menutup masalah ini.` }, { status: 403 });
    if (i.status !== 'open' && i.status !== 'proses') return NextResponse.json({ error: 'Masalah ini sudah ditutup.' }, { status: 409 });
    const solusi = String(b.solusi || '').trim();
    const hasil = String(b.hasil || '');
    if (solusi.length < 5) return NextResponse.json({ error: 'Isi solusi dulu.' }, { status: 400 });
    if (!(hasil in HASIL_META)) return NextResponse.json({ error: 'Pilih hasil: Done/Deal, Masih berjalan, atau Lose.' }, { status: 400 });
    data = { status: 'selesai', solusi: solusi.slice(0, 1000), hasil, selesaiAt: new Date(), selesaiNama: user.name, ...(i.ditanganiAt ? {} : { ditanganiAt: new Date(), ditanganiNama: user.name }) };
    sys = `${closeText(solusi, hasil)} (${user.name})`;
    notifyTo = [...sales, ...(await issueLeadIds(i)), ...i.pjIds];
    title = `✓ Masalah selesai: ${i.customer}`;
    msg = `${cat} — ${solusi} · ${HASIL_META[hasil as keyof typeof HASIL_META]}`;
  } else if (action === 'ubah') {
    if (!isBm) return NextResponse.json({ error: `Hanya ${leadLabel} yang mengubah laporan masalah ini.` }, { status: 403 });
    if (i.status !== 'open' && i.status !== 'proses') return NextResponse.json({ error: 'Masalah ini sudah ditutup.' }, { status: 409 });
    if ('pjIds' in b) {
      const pjIds = await existingUserIds(cleanPjIds(b.pjIds));
      if (!pjIds.length) return NextResponse.json({ error: 'Pilih minimal satu penanggung jawab.' }, { status: 400 });
      data.pjIds = pjIds;
      const added = pjIds.filter((x) => !i.pjIds.includes(x));
      if (added.length) {
        notifyTo = added;
        type = 'issue_new';
        title = `⚑ Anda ditambahkan sebagai PJ: ${i.customer}`;
        msg = `${cat}. ${i.keterangan}`;
      }
      sys = `PJ diubah (${user.name}): ${await pjText(pjIds)}`;
    }
    if ('urgensi' in b && URGENSI.some((u) => u.key === b.urgensi)) data.urgensi = String(b.urgensi);
    if ('targetDate' in b) data.targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.targetDate || '')) ? String(b.targetDate) : null;
    if ('keterangan' in b && String(b.keterangan || '').trim().length >= 10) data.keterangan = String(b.keterangan).trim().slice(0, 2000);
    if (!Object.keys(data).length) return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 });
  }

  const issue = (await prisma.prospectIssue.update({ where: { id }, data: data as never })) as unknown as PipelineIssue;
  emitCrmEvent('issue:updated', issue);
  if (sys) await postSystemMessage(i.prospectId, sys);
  if (notifyTo.length) await notifyIssue(issue, notifyTo, user, type, title, msg);
  await logActivity({ user, action: 'update', entity: 'prospect', entityId: i.prospectId, summary: `Masalah pipeline ${i.customer} (${cat}): ${action}` });
  return NextResponse.json({ issue });
}
