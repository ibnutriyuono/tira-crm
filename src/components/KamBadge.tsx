'use client';

import { buildGroupIndex, groupForCustomer, isKeyTier, KAM_TIER_META } from '@/lib/kam';
import type { CustomerGroup } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';

// One index per groups array, shared by every badge on the board.
const indexCache = new WeakMap<CustomerGroup[], Map<string, CustomerGroup>>();
function indexFor(groups: CustomerGroup[]) {
  let idx = indexCache.get(groups);
  if (!idx) {
    idx = buildGroupIndex(groups);
    indexCache.set(groups, idx);
  }
  return idx;
}

/** Customer name -> Key Account group, from the groups already in the store (index rebuilt only when they change). */
export function useKamGroup(customer: string | null | undefined): CustomerGroup | null {
  const groups = useDataStore((s) => s.customerGroups);
  return groups.length ? groupForCustomer(indexFor(groups), customer) : null;
}

/** ★ Strategic / ★ Key badge for a customer that belongs to a Key Account group. */
export function KamBadge({ customer, showGroup = false }: { customer: string | null | undefined; showGroup?: boolean }) {
  const g = useKamGroup(customer);
  if (!g || !isKeyTier(g.tier)) return null;
  const meta = KAM_TIER_META[g.tier];
  return (
    <span className={`kam-badge ${g.tier}`} title={`${meta.label} · grup ${g.name}${g.homeCabang ? ` · home ${g.homeCabang}` : ''}`}>
      ★ {g.tier === 'strategic' ? 'STRATEGIC' : 'KEY'}
      {showGroup && <span className="kam-badge-group"> · {g.name}</span>}
    </span>
  );
}
