'use client';

import { Modal } from '../Modal';
import { IssueBoard } from '../issues/IssueBoard';
import { useUiStore } from '@/store/useUiStore';

/** Papan Masalah Pipeline: ringkasan, Pareto, per PJ, daftar + detail, saran otomatis. */
export function PipelineIssuesModal() {
  const show = useUiStore((s) => s.modal === 'pipelineIssues');
  const closeModal = useUiStore((s) => s.closeModal);
  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Masalah Pipeline"
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      {show && <IssueBoard variant="board" />}
    </Modal>
  );
}
