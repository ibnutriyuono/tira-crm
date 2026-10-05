'use client';

import { useMemo } from 'react';
import { QCD_DIMS, QCD_FAKTOR, QCD_LEVELS } from '@/lib/qcd';
import { customerKey } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import type { PendingQcd } from '@/store/useUiStore';

/**
 * The structured QCD inputs, shared by the QCD modal (kanban / recap), the
 * prospect form and the activity "→ PO" conversion so all three ask the same
 * thing the same way. Dropdowns are what the KPI QCD dashboard counts; the
 * text boxes beside them are optional detail.
 */
export function QcdFields({ value, onChange, statusVal, required }: { value: PendingQcd; onChange: (v: PendingQcd) => void; statusVal: number; required: boolean }) {
  const prospects = useDataStore((s) => s.prospects);
  const lost = statusVal === 6;
  const star = required ? <span style={{ color: 'var(--rust-500)' }}> *</span> : null;

  // Competitors already on record, one spelling per company, so "PT X" and
  // "pt. x" don't become two competitors in the dashboard.
  const kompetitorOptions = useMemo(() => {
    const m = new Map<string, string>();
    prospects.forEach((p) => {
      const n = (p.qcdKompetitor || '').trim();
      if (n && !m.has(customerKey(n))) m.set(customerKey(n), n);
    });
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  const set = (patch: Partial<PendingQcd>) => onChange({ ...value, ...patch });
  const levelKey = { quality: 'qualityLevel', cost: 'costLevel', delivery: 'deliveryLevel' } as const;
  const textKey = { quality: 'quality', cost: 'cost', delivery: 'delivery' } as const;

  function onKompetitorBlur() {
    // Snap a differently-typed spelling to the one already on record.
    const hit = kompetitorOptions.find((k) => customerKey(k) === customerKey(value.kompetitor));
    if (hit && hit !== value.kompetitor) set({ kompetitor: hit });
  }

  return (
    <div className="form-grid">
      {QCD_DIMS.map((d) => (
        <div key={d.key}>
          <label>
            {d.label} dibanding kompetitor{star}
          </label>
          <select value={value[levelKey[d.key]]} onChange={(e) => set({ [levelKey[d.key]]: e.target.value } as Partial<PendingQcd>)}>
            <option value="">— pilih —</option>
            {QCD_LEVELS.map((l) => (
              <option key={l} value={l}>
                {d.options[l]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={value[textKey[d.key]]}
            onChange={(e) => set({ [textKey[d.key]]: e.target.value } as Partial<PendingQcd>)}
            placeholder={d.key === 'cost' ? 'Keterangan (opsional), cth. selisih 5%' : 'Keterangan (opsional)'}
            style={{ marginTop: 6 }}
          />
        </div>
      ))}
      <div>
        <label>
          Faktor penentu {lost ? 'kekalahan' : 'kemenangan'}
          {star}
        </label>
        <select value={value.faktor} onChange={(e) => set({ faktor: e.target.value })}>
          <option value="">— pilih —</option>
          {QCD_FAKTOR.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="full">
        <label>
          Kompetitor{lost ? (required ? <span style={{ color: 'var(--rust-500)' }}> * (pemenang)</span> : ' (pemenang)') : ' (jika ada)'}
        </label>
        <input type="text" list="qcdKompetitorList" value={value.kompetitor} onChange={(e) => set({ kompetitor: e.target.value })} onBlur={onKompetitorBlur} placeholder="Pilih / ketik nama kompetitor" />
        <datalist id="qcdKompetitorList">
          {kompetitorOptions.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>
      <div className="full">
        <label>Catatan</label>
        <textarea value={value.catatan} onChange={(e) => set({ catatan: e.target.value })} placeholder="Catatan tambahan terkait keputusan customer" />
      </div>
    </div>
  );
}

/** PendingQcd -> the API's field names. */
export function qcdPayload(v: PendingQcd) {
  return {
    qcdQuality: v.quality.trim(),
    qcdCost: v.cost.trim(),
    qcdDelivery: v.delivery.trim(),
    qcdKompetitor: v.kompetitor.trim(),
    qcdCatatan: v.catatan.trim(),
    qcdQualityLevel: v.qualityLevel,
    qcdCostLevel: v.costLevel,
    qcdDeliveryLevel: v.deliveryLevel,
    qcdFaktor: v.faktor,
  };
}
