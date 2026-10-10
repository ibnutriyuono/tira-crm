'use client';

import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { Modal } from '../Modal';
import { PurchasingBoard } from '../PurchasingBoard';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * Read-only view of the purchasing worklist for sales and managers — the same
 * PurchasingBoard the dedicated page renders, with writes disabled.
 */
export function PurchasingMonitorModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'purchasing';
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);

  const canEdit = isPurchasingRoleClient(currentUser?.role) || currentUser?.role === 'admin';

  return (
    <Modal show={show} onClose={closeModal} title="Purchasing" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      {show && <PurchasingBoard readOnly={!canEdit} />}
    </Modal>
  );
}
