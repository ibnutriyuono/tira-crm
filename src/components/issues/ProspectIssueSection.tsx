'use client';

import { useState } from 'react';
import { ISSUE_STATUS_META, isActiveIssue, issueCatLabel, urgensiLabel } from '@/lib/issues';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { IssueForm, issueAgeText, nameOf, useRoster } from './shared';

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/**
 * Bagian "Masalah" di Edit Prospek, tepat di atas Diskusi:
 *  - Sales pemilik: "Ajukan masalah ke BM";
 *  - BM cabangnya: "Laporkan masalah" (atau proses usulan Sales);
 *  - bila ada masalah aktif: ringkasan + tombol buka di papan Masalah Pipeline.
 */
export function ProspectIssueSection({ prospect }: { prospect: Prospect }) {
  const me = useDataStore((s) => s.currentUser);
  const issue = useDataStore((s) => s.issues.find((i) => i.prospectId === prospect.id && isActiveIssue(i))) || null;
  const roster = useRoster();
  const [form, setForm] = useState<'lapor' | 'usulan' | 'terima' | null>(null);
  if (!me) return null;
  const isBm = me.role === 'admin' || (me.role === 'bm' && up(me.cabang) === up(prospect.cabang));
  const isOwner = me.role === 'sales' && up(me.se) === up(prospect.se);
  const running = Number(prospect.status) >= 1 && Number(prospect.status) <= 5;
  if (!issue && !running) return null;
  if (!issue && !isBm && !isOwner) return null;

  const openBoard = () => {
    useUiStore.setState({ issueFocus: { id: issue!.id } });
    useUiStore.getState().openModal('pipelineIssues');
  };

  return (
    <div className="issue-section">
      <div className="issue-section-head">
        <label style={{ margin: 0 }}>Masalah</label>
        {issue && <span className={`badge ${ISSUE_STATUS_META[issue.status].badge}`}>{ISSUE_STATUS_META[issue.status].label}</span>}
      </div>
      {form ? (
        <IssueForm mode={form} prospect={prospect} issue={issue} onDone={() => setForm(null)} onCancel={() => setForm(null)} />
      ) : issue ? (
        <div className="issue-report">
          <div>
            <b>⚑ {issueCatLabel(issue.kategori)}</b> · urgensi {urgensiLabel(issue.urgensi)} · {issueAgeText(issue)}
            {issue.pjIds.length > 0 && <> · PJ: {issue.pjIds.map((id) => nameOf(roster, id)).join(', ')}</>}
          </div>
          <div style={{ marginTop: 3 }}>{issue.keterangan}</div>
          <div className="issue-row" style={{ marginTop: 6 }}>
            {issue.status === 'usulan' && isBm && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm('terima')}>
                Proses usulan (tentukan PJ / tolak)
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={openBoard}>
              Buka di papan Masalah Pipeline
            </button>
            <span className="field-note" style={{ margin: 0 }}>Diskusi masalah memakai thread Diskusi di bawah.</span>
          </div>
        </div>
      ) : (
        <div className="issue-row">
          {isBm ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm('lapor')}>
              ⚑ Laporkan masalah
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm('usulan')}>
              ⚑ Ajukan masalah ke BM
            </button>
          )}
          <span className="field-note" style={{ margin: 0 }}>{isBm ? 'Tentukan penanggung jawab (user) — mereka mendapat notifikasi.' : 'BM akan menerima notifikasi dan membuat laporannya.'}</span>
        </div>
      )}
    </div>
  );
}
