import { notify, tripApproverIds, tripHostIds } from './notify';

export type TripRow = { id: string; ownerId: string; ownerName: string; ownerRole: string; ownerReg: number | null; cabang: string; reg: number | null; tglBerangkat: string; tglPulang: string; visits: unknown; status: string };

const ROLE_SHORT: Record<string, string> = { gm: 'GM', rm: 'RM', bm: 'BM' };

function fmt(d: string): string {
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

/**
 * Who hears about which transition:
 * - submitted (BM/RM)       -> the approvers
 * - approved / GM's own set -> the owner (if someone else approved) and the
 *                              hosts: BM of the destination branch + RM of its region
 * - rejected                -> the owner, with the reason
 * - cancelled               -> the hosts if it had been approved, the
 *                              approvers if it was still waiting
 * The person acting is never notified of their own action.
 */
export async function notifyTripChange(prev: TripRow, newStatus: string, actorId: string, actorName: string, note: string | null) {
  const range = prev.tglBerangkat === prev.tglPulang ? fmt(prev.tglBerangkat) : `${fmt(prev.tglBerangkat)}–${fmt(prev.tglPulang)}`;
  const n = Array.isArray(prev.visits) ? prev.visits.length : 0;
  const who = `${ROLE_SHORT[prev.ownerRole] || prev.ownerRole} ${prev.ownerName}`;
  const base = { entity: 'visitTrip' as const, entityId: prev.id };
  const notMe = (ids: string[]) => ids.filter((x) => x !== actorId);

  if (newStatus === 'diajukan') {
    await notify({
      ...base,
      userIds: notMe(await tripApproverIds(prev.ownerRole, prev.ownerReg)),
      type: 'trip_submitted',
      title: `Rencana perjalanan menunggu persetujuan`,
      message: `${who} mengajukan perjalanan ke ${prev.cabang}, ${range} (${n} kunjungan customer).`,
    });
    return;
  }
  if (newStatus === 'disetujui') {
    if (prev.ownerId !== actorId) {
      await notify({ ...base, userIds: [prev.ownerId], type: 'trip_approved', title: 'Rencana perjalanan disetujui', message: `Perjalanan ke ${prev.cabang}, ${range} disetujui oleh ${actorName}.${note ? ` Catatan: ${note}` : ''}` });
    }
    await notify({
      ...base,
      userIds: notMe(await tripHostIds(prev.cabang, prev.reg)).filter((x) => x !== prev.ownerId),
      type: 'trip_scheduled',
      title: `Kunjungan ${who} ke cabang ${prev.cabang}`,
      message: `${who} akan berkunjung ke ${prev.cabang} pada ${range}, ${n} kunjungan customer. Buka untuk melihat daftar customer & tujuannya.`,
    });
    return;
  }
  if (newStatus === 'ditolak') {
    await notify({ ...base, userIds: [prev.ownerId], type: 'trip_rejected', title: 'Rencana perjalanan ditolak', message: `Perjalanan ke ${prev.cabang}, ${range} ditolak oleh ${actorName}. Alasan: ${note || '-'}` });
    return;
  }
  if (newStatus === 'batal') {
    const ids = prev.status === 'disetujui' ? await tripHostIds(prev.cabang, prev.reg) : prev.status === 'diajukan' ? await tripApproverIds(prev.ownerRole, prev.ownerReg) : [];
    await notify({
      ...base,
      userIds: notMe(ids).filter((x) => x !== prev.ownerId),
      type: 'trip_cancelled',
      title: `Perjalanan ${who} ke ${prev.cabang} dibatalkan`,
      message: `Perjalanan ${range} dibatalkan.${note ? ` Alasan: ${note}` : ''}`,
    });
  }
}
