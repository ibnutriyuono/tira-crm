import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { notify, opsLeadIds, purchasingUserIds, vpIds } from './notify';
import { normalizeOpsRules, type OpsRules } from './ops-rules';
import { buildPoIndent } from './po-indent';
import { rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import { jakartaToday } from './followup-notify';
import type { Prospect, Rfq } from './types';

export const OPS_RULES_KEY = 'opsRules';
const SENT_KEY = 'opsEscalationSent';

export async function getOpsRules(): Promise<OpsRules> {
  const row = await prisma.setting.findUnique({ where: { key: OPS_RULES_KEY } });
  return normalizeOpsRules(row?.value);
}

const dayDiff = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86400000);

let lastSweep = 0;
/**
 * Pengingat & eskalasi otomatis Operation (tanpa penjadwal: dicek saat CRM /
 * Notifikasi dibuka, paling sering tiap 5 menit). Sekali per tingkat:
 *  - RFQ belum dijawab > rfqIngatHari → Purchasing; > rfqEskalasiHari → GM Operation.
 *  - Barang (PO Indent) lewat target kedatangan > telatOpsHari → GM Operation;
 *    > telatVpHari → VP. Target dimundurkan = dihitung ulang dari target baru.
 * Tingkat yang sudah dikirim disimpan di Setting "opsEscalationSent".
 */
export async function sweepOpsEscalation(opts: { force?: boolean; today?: string } = {}): Promise<void> {
  if (!opts.force && Date.now() - lastSweep < 5 * 60 * 1000) return;
  lastSweep = Date.now();
  try {
    const rules = await getOpsRules();
    const today = opts.today || jakartaToday();
    const row = await prisma.setting.findUnique({ where: { key: SENT_KEY } });
    const sent = { rfq: {}, eta: {}, ...((row?.value as Record<string, Record<string, number>>) || {}) } as { rfq: Record<string, number>; eta: Record<string, number> };
    const next: typeof sent = { rfq: {}, eta: {} };
    let changed = false;

    // ── RFQ belum dijawab ────────────────────────────────────────────────
    const rfqs = (await prisma.rfq.findMany({ where: { cancelledAt: null, sentToPurchasingAt: { not: null } } })) as unknown as Rfq[];
    const ops = await opsLeadIds();
    for (const r of rfqs) {
      const stage = workflowStage(rfqAsWorkflowDoc(r));
      if (stage !== 1 && stage !== 2) continue;
      const age = dayDiff(new Date(r.sentToPurchasingAt as unknown as string).toISOString().slice(0, 10), today);
      const was = sent.rfq[r.id] || 0;
      let lvl = was;
      if (age > rules.rfqEskalasiHari && was < 2) {
        // Pengingat ke Purchasing yang belum terkirim ikut dikirim bersama eskalasi.
        if (was < 1) await notify({ userIds: await purchasingUserIds(r.items), type: 'ops_escalated', entity: 'rfq', entityId: r.id, title: `Pengingat: RFQ ${r.noRfq || ''} belum dijawab ${age} hari`, message: `${r.cabang || '-'} · ${r.customer || '-'} · sudah diteruskan ke GM Operation.` });
        await notify({ userIds: ops, type: 'ops_escalated', entity: 'rfq', entityId: r.id, title: `Eskalasi: RFQ ${r.noRfq || ''} belum dijawab ${age} hari`, message: `${r.cabang || '-'} · ${r.customer || '-'} · batas ${rules.rfqEskalasiHari} hari. Purchasing sudah diingatkan.` });
        lvl = 2;
      } else if (age > rules.rfqIngatHari && was < 1) {
        await notify({ userIds: await purchasingUserIds(r.items), type: 'ops_escalated', entity: 'rfq', entityId: r.id, title: `Pengingat: RFQ ${r.noRfq || ''} belum dijawab ${age} hari`, message: `${r.cabang || '-'} · ${r.customer || '-'} · target jawab ${rules.rfqTargetHari} hari. Lewat ${rules.rfqEskalasiHari} hari diteruskan ke GM Operation.` });
        lvl = 1;
      }
      if (lvl) next.rfq[r.id] = lvl;
      if (lvl !== was) changed = true;
    }

    // ── Barang lewat target kedatangan (PO Indent) ───────────────────────
    const prospects = (await prisma.prospect.findMany({ where: { status: { in: [4, 5] } } })) as unknown as Prospect[];
    const groups = buildPoIndent(prospects);
    const vps = await vpIds();
    for (const g of groups) {
      for (const it of g.items) {
        if (!it.eta || it.stat === 'tiba' || it.eta >= today) continue;
        const late = dayDiff(it.eta, today);
        const key = `${g.prospectId}|${it.itemId}|${it.eta}`;
        const was = sent.eta[key] || 0;
        let lvl = was;
        const what = `${it.label} (${g.noPo || 'PO'} · ${g.customer || '-'} · ${g.cabang || '-'})`;
        if (late > rules.telatVpHari && was < 2 && vps.length) {
          await notify({ userIds: [...vps, ...ops], type: 'po_eta', entity: 'prospect', entityId: g.prospectId, title: `Eskalasi VP: barang telat ${late} hari`, message: `${what} — target ${it.eta}, belum tiba.` });
          lvl = 2;
        } else if (late > rules.telatOpsHari && was < 1) {
          await notify({ userIds: ops, type: 'po_eta', entity: 'prospect', entityId: g.prospectId, title: `Barang telat ${late} hari`, message: `${what} — target ${it.eta}, belum tiba. Lewat ${rules.telatVpHari} hari diteruskan ke VP.` });
          lvl = 1;
        }
        if (lvl) next.eta[key] = lvl;
        if (lvl !== was) changed = true;
      }
    }
    // Simpan hanya yang masih aktif (RFQ terjawab / barang tiba otomatis terhapus).
    if (changed || Object.keys(sent.rfq).length !== Object.keys(next.rfq).length || Object.keys(sent.eta).length !== Object.keys(next.eta).length) {
      const value = next as unknown as Prisma.InputJsonValue;
      await prisma.setting.upsert({ where: { key: SENT_KEY }, update: { value }, create: { key: SENT_KEY, value } });
    }
  } catch (err) {
    console.error('[ops-escalation] gagal', err);
  }
}
