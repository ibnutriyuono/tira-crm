'use client';

import { ROLE_LABELS } from '@/lib/constants';
import type { RosterUser } from './issues/shared';

const lbl = (u: RosterUser) => `${u.name} · ${ROLE_LABELS[u.role] || u.role}${u.cabang ? ` ${u.cabang}` : ''}`;

/** Chip user + pilih user dari daftar (peserta perjalanan, dll.). */
export function UserPicker({ value, onChange, roster, exclude = [], placeholder = '+ Tambah (pilih user)…', disabled }: {
  value: string[];
  onChange: (v: string[]) => void;
  roster: RosterUser[];
  exclude?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="issue-pj">
      <div className="issue-pj-chips">
        {value.map((id) => {
          const u = roster.find((x) => x.id === id);
          return (
            <span key={id} className="kam-chip">
              {u ? lbl(u) : '(user)'}
              {!disabled && (
                <button type="button" aria-label={`Hapus ${u?.name || ''}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!disabled && (
        <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">{placeholder}</option>
          {roster.filter((u) => !value.includes(u.id) && !exclude.includes(u.id) && u.role !== 'admin' && u.role !== 'purchasing05').map((u) => (
            <option key={u.id} value={u.id}>{lbl(u)}</option>
          ))}
        </select>
      )}
    </div>
  );
}
