'use client';

import { useMemo } from 'react';
import { QCD_DIMS, QCD_FAKTOR, QCD_LEVELS } from '@/lib/qcd';
import { ITEM_OUTCOME_META, itemQcdMissing, type ItemOutcome, type ItemQcd } from '@/lib/item-qcd';
import { getProspectMaterials } from '@/lib/format';
import { customerKey } from '@/lib/reports';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';

export interface ItemQcdRow {
  itemId: string;
  label: string;
  outcome: ItemOutcome;
  /** cth. "PO 2 dari 5 pcs" */
  detail?: string;
}

export type ItemQcdDraft = Record<string, ItemQcd>;

const LEVEL_KEY = { quality: 'qualityLevel', cost: 'costLevel', delivery: 'deliveryLevel' } as const;
const SHORT: Record<string, string> = { quality: 'Quality', cost: 'Cost', delivery: 'Delivery' };

/**
 * Isian awal QCD per item: QCD item yang sudah tersimpan; bila belum ada,
 * QCD prospek -- hanya untuk item yang hasilnya searah dengan deal (item
 * menang di deal Won, item kalah di deal Lose). Item yang lepas dari deal
 * Won diisi dari nol karena alasannya berbeda.
 */
export function initialItemQcd(p: Prospect, rows: { itemId: string; outcome: ItemOutcome; qcd: ItemQcd | null }[]): ItemQcdDraft {
  const lostDeal = Number(p.status) === 6;
  const base: ItemQcd = {
    qualityLevel: p.qcdQualityLevel || '',
    costLevel: p.qcdCostLevel || '',
    deliveryLevel: p.qcdDeliveryLevel || '',
    faktor: p.qcdFaktor || '',
    kompetitor: p.qcdKompetitor || '',
  };
  const out: ItemQcdDraft = {};
  rows.forEach((r) => {
    if (r.qcd) out[r.itemId] = { ...r.qcd };
    else if (lostDeal || r.outcome === 'menang') out[r.itemId] = { ...base };
    else out[r.itemId] = {};
  });
  return out;
}

/** Pesan galat pertama untuk draft QCD per item, atau null. */
export function itemQcdError(rows: ItemQcdRow[], draft: ItemQcdDraft): string | null {
  for (const r of rows) {
    const miss = itemQcdMissing(draft[r.itemId], r.outcome);
    if (miss.length) return `QCD item "${r.label}" belum lengkap: ${miss.join(', ')}.`;
  }
  return null;
}

/**
 * Tabel QCD per item: hasil (menang / sebagian / kalah), Quality · Cost ·
 * Delivery dibanding kompetitor, faktor penentu, dan kompetitor (pemenang
 * untuk item yang lepas). Dipakai di Status Item (konfirmasi PO & QCD per item).
 */
export function ItemQcdTable({ rows, value, onChange, disabled }: { rows: ItemQcdRow[]; value: ItemQcdDraft; onChange: (v: ItemQcdDraft) => void; disabled?: boolean }) {
  const tr = useT();
  const prospects = useDataStore((s) => s.prospects);

  // Nama kompetitor yang sudah tercatat (prospek & item), satu ejaan per perusahaan.
  const kompetitorOptions = useMemo(() => {
    const m = new Map<string, string>();
    const add = (n: string | null | undefined) => {
      const v = (n || '').trim();
      if (v && !m.has(customerKey(v))) m.set(customerKey(v), v);
    };
    prospects.forEach((p) => {
      add(p.qcdKompetitor);
      (getProspectMaterials(p) as { qcd?: ItemQcd }[]).forEach((x) => add(x.qcd?.kompetitor));
    });
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  const set = (id: string, patch: Partial<ItemQcd>) => onChange({ ...value, [id]: { ...(value[id] || {}), ...patch } });
  const snap = (id: string) => {
    const cur = value[id]?.kompetitor || '';
    const hit = kompetitorOptions.find((k) => customerKey(k) === customerKey(cur));
    if (hit && hit !== cur) set(id, { kompetitor: hit });
  };

  /** Salin isian satu item ke item lain dengan hasil yang sama. */
  function copyToSame(r: ItemQcdRow) {
    const src = value[r.itemId] || {};
    const next = { ...value };
    rows.forEach((x) => {
      if (x.itemId !== r.itemId && x.outcome === r.outcome) next[x.itemId] = { ...src };
    });
    onChange(next);
  }

  return (
    <div className="table-wrap iq-wrap" style={{ borderTop: 'none' }}>
      <table className="simple-table iq-table">
        <thead>
          <tr>
            <th>{tr("Material")}</th>
            <th>{tr("Hasil")}</th>
            {QCD_DIMS.map((d) => (
              <th key={d.key}>{SHORT[d.key]}</th>
            ))}
            <th>{tr("Faktor penentu")}</th>
            <th>{tr("Kompetitor")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = value[r.itemId] || {};
            const miss = itemQcdMissing(q, r.outcome);
            const lepas = r.outcome !== 'menang';
            const sameCount = rows.filter((x) => x.outcome === r.outcome).length;
            return (
              <tr key={r.itemId} className={miss.length ? 'iq-miss' : ''}>
                <td className="iq-mat">
                  <div>{r.label}</div>
                  {r.detail && <div className="iq-sub">{r.detail}</div>}
                  {sameCount > 1 && !disabled && (
                    <button type="button" className="iq-copy" onClick={() => copyToSame(r)} title={tr("Salin isian baris ini ke item lain dengan hasil yang sama")}>
                      {tr("Salin ke item lain")} ({tr(ITEM_OUTCOME_META[r.outcome].label).toLowerCase()})
                    </button>
                  )}
                </td>
                <td>
                  <span className={`badge ${ITEM_OUTCOME_META[r.outcome].color}`}>{tr(ITEM_OUTCOME_META[r.outcome].label)}</span>
                </td>
                {QCD_DIMS.map((d) => (
                  <td key={d.key}>
                    <select
                      disabled={disabled}
                      aria-label={`${d.label} ${r.label}`}
                      value={q[LEVEL_KEY[d.key]] || ''}
                      onChange={(e) => set(r.itemId, { [LEVEL_KEY[d.key]]: e.target.value } as Partial<ItemQcd>)}
                    >
                      <option value="">—</option>
                      {QCD_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {d.options[l]}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td>
                  <select disabled={disabled} aria-label={`${tr("Faktor penentu")} ${r.label}`} value={q.faktor || ''} onChange={(e) => set(r.itemId, { faktor: e.target.value })}>
                    <option value="">—</option>
                    {QCD_FAKTOR.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    disabled={disabled}
                    list="iqKompetitorList"
                    aria-label={`${tr("Kompetitor")} ${r.label}`}
                    value={q.kompetitor || ''}
                    onChange={(e) => set(r.itemId, { kompetitor: e.target.value })}
                    onBlur={() => snap(r.itemId)}
                    placeholder={lepas ? tr("Pemenang *") : tr("Jika ada")}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id="iqKompetitorList">
        {kompetitorOptions.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}
