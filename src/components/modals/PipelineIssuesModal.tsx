'use client';

import { Modal } from '../Modal';
import { IssueBoard } from '../issues/IssueBoard';
import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
/** Papan Masalah Pipeline: ringkasan, Pareto, per PJ, daftar + detail, saran otomatis. */
export function PipelineIssuesModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'pipelineIssues');
  const closeModal = useUiStore((s) => s.closeModal);
  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("Masalah Pipeline")}
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          {tr("Tutup")}
        </button>
      }
    >
      {show && <IssueBoard variant="board" />}
    </Modal>
  );
}
