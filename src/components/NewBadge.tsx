'use client';

import { isCreatedToday, localTimeOf } from '@/lib/new-records';

/** "BARU" pill for a record created today; renders nothing otherwise. */
export function NewBadge({ createdAt }: { createdAt?: string | null }) {
  if (!createdAt || !isCreatedToday({ createdAt })) return null;
  return (
    <span className="new-badge" title={`Dibuat hari ini pukul ${localTimeOf(createdAt)}`}>
      BARU
    </span>
  );
}
