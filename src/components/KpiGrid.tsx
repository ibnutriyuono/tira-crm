'use client';

import { classify, formatRupiah, num } from '@/lib/format';
import type { Prospect } from '@/lib/types';

import { useT } from '@/store/useLangStore';
export function KpiGrid({ list }: { list: Prospect[] }) {
  const tr = useT();
  const total = list.length;
  const totalValue = list.reduce((s, r) => s + num(r.value), 0);
  const won = list.filter((r) => classify(r) === 'Won');
  const lost = list.filter((r) => classify(r) === 'Lost');
  const aktif = list.filter((r) => classify(r) === 'Aktif');
  const aktifValue = aktif.reduce((s, r) => s + num(r.value), 0);
  const wonValue = won.reduce((s, r) => s + num(r.value), 0);
  const closedCount = won.length + lost.length;
  const winRate = closedCount > 0 ? (won.length / closedCount) * 100 : 0;
  const pendingPenawaran = list.filter((r) => !r.penawaranTerkirim && classify(r) === 'Aktif');
  // DO rows split by invoice status: invoiced counts as Omzet, the rest is
  // GIT (goods in transit).
  const doList = list.filter((r) => num(r.status) === 5);
  const omzetList = doList.filter((r) => r.terfaktur);
  const gitList = doList.filter((r) => !r.terfaktur);
  const activity = list.filter((r) => classify(r) === 'Activity');

  return (
    <div className="kpi-grid">
      <div className="kpi">
        <div className="label">{tr("Total Prospek")}</div>
        <div className="value">{total.toLocaleString('id-ID')}</div>
        <div className="foot">{tr("Total nilai")} {formatRupiah(totalValue)}</div>
      </div>
      <div className="kpi aktif">
        <div className="label">{tr("Aktif Pipeline")}</div>
        <div className="value">{aktif.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(aktifValue)}</div>
      </div>
      <div className="kpi won">
        <div className="label">{tr("Won")}</div>
        <div className="value">{won.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(wonValue)}</div>
      </div>
      <div className="kpi lost">
        <div className="label">{tr("Lost")}</div>
        <div className="value">{lost.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(lost.reduce((s, r) => s + num(r.value), 0))}</div>
      </div>
      <div className="kpi rate">
        <div className="label">{tr("Win Rate")}</div>
        <div className="value">{winRate.toFixed(1)}%</div>
        <div className="foot">{tr("dari")} {closedCount.toLocaleString('id-ID')} {tr("closed")}</div>
      </div>
      <div className="kpi pending">
        <div className="label">{tr("Penawaran Pending")}</div>
        <div className="value">{pendingPenawaran.length.toLocaleString('id-ID')}</div>
        <div className="foot">{tr("Belum dikirim ke customer")}</div>
      </div>
      <div className="kpi omzet">
        <div className="label">{tr("Omzet (Terfaktur)")}</div>
        <div className="value">{formatRupiah(omzetList.reduce((s, r) => s + num(r.value), 0))}</div>
        <div className="foot">{omzetList.length.toLocaleString('id-ID')} {tr("DO sudah terfaktur")}</div>
      </div>
      <div className="kpi git">
        <div className="label">{tr("GIT (Belum Terfaktur)")}</div>
        <div className="value">{formatRupiah(gitList.reduce((s, r) => s + num(r.value), 0))}</div>
        <div className="foot">{gitList.length.toLocaleString('id-ID')} {tr("DO barang jalan")}</div>
      </div>
      <div className="kpi">
        <div className="label">{tr("Sales Activity")}</div>
        <div className="value">{activity.length.toLocaleString('id-ID')}</div>
        <div className="foot">{tr("Kunjungan & kegiatan tercatat")}</div>
      </div>
    </div>
  );
}
