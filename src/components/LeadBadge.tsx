'use client';

import { isLead, leadSourceLabel } from '@/lib/leads';
import type { Prospect } from '@/lib/types';

/** Penanda prospek yang berasal dari lead Product & Marketing (sumber & pembuat di tooltip). */
export function LeadBadge({ p, compact }: { p: Pick<Prospect, 'leadAt' | 'leadSource' | 'leadBy' | 'se'>; compact?: boolean }) {
  if (!isLead(p)) return null;
  const src = leadSourceLabel(p.leadSource);
  const tip = `Lead dari Marketing${p.leadBy ? ` (${p.leadBy})` : ''}${src ? ` · ${src}` : ''}${p.leadAt ? ` · ${String(p.leadAt).slice(0, 10)}` : ''}${(p.se || '').trim() ? '' : ' — belum ada Sales yang ditunjuk'}`;
  return (
    <span className="lead-badge" title={tip}>
      ★ {compact ? 'Lead' : `Lead${src ? ` · ${src}` : ''}`}
      {!(p.se || '').trim() && <span aria-hidden="true">· !</span>}
    </span>
  );
}
