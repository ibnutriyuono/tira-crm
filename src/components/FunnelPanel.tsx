'use client';

import { FUNNEL_STAGES, STATUS_META } from '@/lib/constants';
import { classify, formatRupiah, num } from '@/lib/format';
import type { Prospect } from '@/lib/types';

export function FunnelPanel({ list }: { list: Prospect[] }) {
  const maxCount = Math.max(1, ...FUNNEL_STAGES.map((s) => list.filter((r) => num(r.status) === s).length));
  const won = list.filter((r) => classify(r) === 'Won');
  const lost = list.filter((r) => classify(r) === 'Lost');

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Pipeline Funnel</h2>
        <span className="hint">Berdasarkan data hasil filter saat ini</span>
      </div>
      <div className="funnel">
        <div className="funnel-stages">
          {FUNNEL_STAGES.map((s) => {
            const items = list.filter((r) => num(r.status) === s);
            const count = items.length;
            const val = items.reduce((sum, r) => sum + num(r.value), 0);
            const widthPct = Math.max(3, (count / maxCount) * 100);
            return (
              <div className="stage-row" key={s}>
                <div className="stage-name">
                  {s} · {STATUS_META[s].label}
                </div>
                <div className="stage-track">
                  <div className="stage-fill" style={{ width: `${widthPct}%` }}>
                    {count}
                  </div>
                </div>
                <div className="stage-meta">{formatRupiah(val)}</div>
              </div>
            );
          })}
        </div>
        <div className="funnel-side">
          <div className="side-card won">
            <div className="t">Won</div>
            <div className="n">{won.length}</div>
            <div className="v">{formatRupiah(won.reduce((s, r) => s + num(r.value), 0))}</div>
          </div>
          <div className="side-card lost">
            <div className="t">Lost</div>
            <div className="n">{lost.length}</div>
            <div className="v">{formatRupiah(lost.reduce((s, r) => s + num(r.value), 0))}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
