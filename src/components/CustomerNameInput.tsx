'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { buildNameIndex, suggestName, type NameSource } from '@/lib/customer-names';
import { useDataStore } from '@/store/useDataStore';

/**
 * Standard-name index of every customer this user can see: Kelola Customer
 * names are the reference spelling, prospect/RFQ/FUP A spellings are counted
 * so the most used one wins when a company isn't registered yet.
 */
export function useCustomerNameIndex() {
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  return useMemo(() => {
    const src: NameSource[] = [];
    customers.forEach((c) => c.name && src.push({ name: c.name, count: 1, master: true }));
    prospects.forEach((p) => p.customer && src.push({ name: p.customer, count: 1 }));
    rfqs.forEach((r) => r.customer && src.push({ name: r.customer, count: 1 }));
    fupas.forEach((f) => f.customer && src.push({ name: f.customer, count: 1 }));
    return buildNameIndex(src);
  }, [customers, prospects, rfqs, fupas]);
}

/**
 * Customer name field used by every form that names a customer. The dropdown
 * lists only standard spellings; a name typed differently for the same
 * company ("pt. contoh baja") is corrected to the standard one when the field
 * loses focus, and a near match (typo) gets a "Maksud Anda ...?" button.
 *
 * `mode="warn"` (Kelola Customer form) never changes the value -- it only
 * warns that the company may already exist.
 */
export function CustomerNameInput({
  value,
  onChange,
  placeholder = 'Pilih / ketik nama customer',
  required,
  style,
  mode = 'fix',
  ignore,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  style?: CSSProperties;
  mode?: 'fix' | 'warn';
  /** A name to not warn about (the customer being edited). */
  ignore?: string;
}) {
  const listId = useId();
  const index = useCustomerNameIndex();
  const [fixedFrom, setFixedFrom] = useState('');
  const sugg = useMemo(() => {
    const s = suggestName(value, index);
    if (!s) return null;
    if (ignore && s.name.trim().toLowerCase() === ignore.trim().toLowerCase()) return null;
    return s;
  }, [value, index, ignore]);

  function onBlur() {
    if (mode === 'fix' && sugg?.type === 'exact') {
      setFixedFrom(value.trim());
      onChange(sugg.name);
    }
  }

  return (
    <div style={style}>
      <input
        type="text"
        list={listId}
        required={required}
        value={value}
        onChange={(e) => {
          setFixedFrom('');
          onChange(e.target.value);
        }}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      <datalist id={listId}>
        {index.canonicals.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {fixedFrom && !sugg && (
        <div className="field-note" style={{ marginTop: 3 }}>
          Disesuaikan ke nama baku (sebelumnya &quot;{fixedFrom}&quot;).
        </div>
      )}
      {sugg && mode === 'warn' && (
        <div className="field-note" style={{ marginTop: 3, color: 'var(--rust-500)' }}>
          {sugg.type === 'exact' ? 'Customer ini sudah ada' : 'Mirip customer yang sudah ada'}: <b>{sugg.name}</b>. Pastikan bukan data ganda.
        </div>
      )}
      {sugg && mode === 'fix' && (
        <div className="field-note" style={{ marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            {sugg.type === 'exact' ? 'Nama baku' : 'Maksud Anda'}: <b>{sugg.name}</b>
            {sugg.type === 'similar' ? '?' : ''}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setFixedFrom(value.trim());
              onChange(sugg.name);
            }}
          >
            Pakai nama ini
          </button>
        </div>
      )}
    </div>
  );
}
