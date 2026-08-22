'use client';

import { useEffect, useState } from 'react';

const cache = new Map<string, number>();

/**
 * Attachment count + note indicator for an RFQ / FUP A row, mirroring the
 * single-file app's renderAttachNoteBadges(). Counts are fetched once per
 * document and memoised, since a long list would otherwise issue one request
 * per row on every re-render.
 */
export function AttachNoteBadges({ rfqId, fupaId, catatan }: { rfqId?: string | null; fupaId?: string | null; catatan?: string | null }) {
  const key = rfqId ? `rfq:${rfqId}` : fupaId ? `fupa:${fupaId}` : '';
  const [count, setCount] = useState<number>(() => cache.get(key) ?? 0);

  useEffect(() => {
    if (!key) return;
    if (cache.has(key)) {
      setCount(cache.get(key) ?? 0);
      return;
    }
    let cancelled = false;
    const query = rfqId ? `rfqId=${rfqId}` : `fupaId=${fupaId}`;
    fetch(`/api/attachments?${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const n = (d.attachments || []).length;
        cache.set(key, n);
        setCount(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, rfqId, fupaId]);

  if (!count && !catatan) return <span className="text-muted">-</span>;

  return (
    <>
      {count > 0 && (
        <span className="badge attach-count" title={`${count} lampiran file`}>
          📎 {count}
        </span>
      )}
      {catatan && (
        <span className="badge slate" title={catatan} style={{ marginLeft: count ? 4 : 0 }}>
          Catatan
        </span>
      )}
    </>
  );
}
