'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '../Modal';
import { LeadDesk } from './LeadDesk';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';

/** Beranda pimpinan (VP / GM Operation) dari CRM. Tautan Operation membuka ruang kerja Purchasing. */
export function LeadDeskModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const router = useRouter();
  const inPurch = typeof window !== 'undefined' && window.location.pathname.startsWith('/purchasing');
  return (
    <Modal show={modal === 'leadDesk'} onClose={closeModal} title={tr('Beranda Pimpinan')} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>}>
      <LeadDesk
        onGoTab={
          inPurch
            ? undefined
            : (t) => {
                closeModal();
                if (t === 'indent') useUiStore.setState({ purchTabFocus: 'indent' });
                router.push('/purchasing');
              }
        }
      />
    </Modal>
  );
}
