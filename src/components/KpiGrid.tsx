'use client';

import { classify, formatRupiah, num } from '@/lib/format';
import type { Prospect } from '@/lib/types';

export function KpiGrid({ list }: { list: Prospect[] }) {
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
        <div className="label">Total Prospek</div>
        <div className="value">{total.toLocaleString('id-ID')}</div>
        <div className="foot">Total nilai {formatRupiah(totalValue)}</div>
      </div>
      <div className="kpi aktif">
        <div className="label">Aktif Pipeline</div>
        <div className="value">{aktif.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(aktifValue)}</div>
      </div>
      <div className="kpi won">
        <div className="label">Won</div>
        <div className="value">{won.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(wonValue)}</div>
      </div>
      <div className="kpi lost">
        <div className="label">Lost</div>
        <div className="value">{lost.length.toLocaleString('id-ID')}</div>
        <div className="foot">{formatRupiah(lost.reduce((s, r) => s + num(r.value), 0))}</div>
      </div>
      <div className="kpi rate">
        <div className="label">Win Rate</div>
        <div className="value">{winRate.toFixed(1)}%</div>
        <div className="foot">dari {closedCount.toLocaleString('id-ID')} closed</div>
      </div>
      <div className="kpi pending">
        <div className="label">Penawaran Pending</div>
        <div className="value">{pendingPenawaran.length.toLocaleString('id-ID')}</div>
        <div className="foot">Belum dikirim ke customer</div>
      </div>
      <div className="kpi omzet">
        <div className="label">Omzet (Terfaktur)</div>
        <div className="value">{formatRupiah(omzetList.reduce((s, r) => s + num(r.value), 0))}</div>
        <div className="foot">{omzetList.length.toLocaleString('id-ID')} DO sudah terfaktur</div>
      </div>
      <div className="kpi git">
        <div className="label">GIT (Belum Terfaktur)</div>
        <div className="value">{formatRupiah(gitList.reduce((s, r) => s + num(r.value), 0))}</div>
        <div className="foot">{gitList.length.toLocaleString('id-ID')} DO barang jalan</div>
      </div>
      <div className="kpi">
        <div className="label">Sales Activity</div>
        <div className="value">{activity.length.toLocaleString('id-ID')}</div>
        <div className="foot">Kunjungan &amp; kegiatan tercatat</div>
      </div>
    </div>
  );
}
