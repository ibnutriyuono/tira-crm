'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { OPS_RULE_FIELDS, normalizeOpsRules, type OpsRules } from '@/lib/ops-rules';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';

/**
 * Admin: batas waktu pengingat / eskalasi Operation dan margin minimum Surat
 * Penawaran (lib/ops-rules.ts). Berlaku untuk semua user begitu disimpan.
 */
export function OpsRulesModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const rules = useDataStore((s) => s.opsRules);
  const setOpsRules = useDataStore((s) => s.setOpsRules);
  const toast = useDataStore((s) => s.toast);
  const isAdmin = useDataStore((s) => s.currentUser?.role === 'admin');
  const show = modal === 'opsRules';
  const [draft, setDraft] = useState<Record<keyof OpsRules, string>>(() => toDraft(rules));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setDraft(toDraft(rules));
  }, [show, rules]);

  async function save() {
    setBusy(true);
    try {
      const r = await api.put<{ opsRules: OpsRules }>('/api/settings/ops-rules', Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])));
      setOpsRules(r.opsRules);
      toast(tr('Batas waktu & margin disimpan'), 'success');
      closeModal();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  const preview = normalizeOpsRules(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])));
  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Batas Waktu & Margin')}
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>
          {isAdmin && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{tr('Simpan')}</button>}
        </>
      }
    >
      <p className="field-note" style={{ marginTop: 0 }}>{tr('Dipakai pengingat & eskalasi otomatis Operation (RFQ belum dijawab, barang telat) dan persetujuan margin oleh VP di Surat Penawaran.')}</p>
      <div className="or-grid">
        {OPS_RULE_FIELDS.map((f) => (
          <label key={f.key} className="or-row">
            <span>
              <b>{tr(f.label)}</b>
              <span className="muted">{tr(f.hint)}</span>
            </span>
            <span className="or-in">
              <input type="number" min={f.min} max={f.max} step={f.unit === '%' ? 0.5 : 1} value={draft[f.key]} disabled={!isAdmin} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              <span className="muted">{tr(f.unit)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="or-flow">
        <b>{tr('Alurnya')}</b>
        <span>
          {tr('RFQ belum dijawab')}: &gt; {preview.rfqIngatHari} {tr('hari')} → Purchasing · &gt; {preview.rfqEskalasiHari} {tr('hari')} → GM Operation
        </span>
        <span>
          {tr('Barang lewat target kedatangan')}: &gt; {preview.telatOpsHari} {tr('hari')} → GM Operation · &gt; {preview.telatVpHari} {tr('hari')} → VP
        </span>
        <span>
          {tr('Surat Penawaran dengan margin di bawah')} {preview.marginMin}% {tr('dari HPP → perlu persetujuan VP')}
        </span>
      </div>
    </Modal>
  );
}

function toDraft(r: OpsRules): Record<keyof OpsRules, string> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])) as Record<keyof OpsRules, string>;
}
