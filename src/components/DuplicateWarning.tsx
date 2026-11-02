'use client';

import { STATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah } from '@/lib/format';
import type { DupView } from '@/lib/prospect-duplicates';
import { useT } from '@/store/useLangStore';

const KIND_LABEL: Record<DupView['kind'], string> = {
  identik: 'Customer sama · material & qty sama',
  sebagian: 'Customer sama · sebagian item sama',
  'beda-customer': 'Customer lain · material & qty identik',
};

/**
 * Peringatan prospek ganda / mirip di form prospek. Prospek di luar wilayah
 * user tampil terbatas (cabang, SE, tahap, tanggal) dan tidak bisa dibuka.
 */
export function DuplicateWarning({ matches, emphasize, onOpen }: { matches: DupView[]; emphasize: boolean; onOpen?: (id: string) => void }) {
  const tr = useT();
  const sameCust = matches.filter((m) => m.sameCustomer).length;
  return (
    <div className={`dup-warn${emphasize ? ' strong' : ''}`} role="alert">
      <div className="dup-warn-h">
        <b>⚠ {tr('Mirip')} {matches.length} {tr('prospek lain')}</b>
        <span>
          {sameCust > 0 ? tr('Kemungkinan prospek yang sama sudah diinput.') : tr('Permintaan dengan material & qty yang sama sudah ada untuk customer lain.')}{' '}
          {emphasize ? tr('Tekan "Tetap simpan" bila memang berbeda — BM cabang terkait akan diberi tahu.') : tr('Periksa dulu sebelum menyimpan.')}
        </span>
      </div>
      <ul>
        {matches.map((m, i) => (
          <li key={m.id || i}>
            <span className={`dup-kind ${m.kind}`}>{tr(KIND_LABEL[m.kind])}</span>
            <div className="dup-main">
              <b>{m.customer || tr('Customer lain')}</b>
              <small>
                {[m.cabang, m.se ? `SE ${m.se}` : null, tr(STATUS_META[m.status]?.label || ''), m.tgl ? formatDateID(m.tgl) : null, m.value != null ? formatRupiah(m.value) : null].filter(Boolean).join(' · ')}
                {!m.inScope && ` · ${tr('di luar wilayah Anda')}`}
              </small>
              <small className="dup-items">
                {m.matched}/{m.total} {tr('item sama')}: {m.items.join('; ')}
                {m.matched < m.total || m.otherTotal > m.matched ? ` · ${tr('prospek itu punya')} ${m.otherTotal} ${tr('item')}` : ''}
              </small>
            </div>
            {m.id && onOpen && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(m.id as string)} title={tr('Batal membuat yang baru, buka prospek itu')}>
                {tr('Buka prospek itu')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
