'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { TICKER_ITEMS, TICKER_MAX_MESSAGES, buildTickerLines, type TickerData, type TickerItemKey } from '@/lib/ticker';
import { buildPersonalTicker } from '@/lib/ticker-personal';
import { useDataStore } from '@/store/useDataStore';
import { IconEdit } from './icons';

const GROUPS = Array.from(new Set(TICKER_ITEMS.map((i) => i.group)));
const dots = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString('id-ID') : '');
const undot = (s: string) => Number(s.replace(/\D/g, '')) || null;

/**
 * Running text under the top bar. GM/Admin pick which items appear
 * (checklist), can set a manual exchange rate and write custom messages.
 * Company-wide items come from /api/ticker; personal reminders are computed
 * here from the user's own data. Refreshes when a prospect changes
 * (debounced), when the settings change, and every 5 minutes.
 */
export function RunningText() {
  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const toast = useDataStore((s) => s.toast);
  const canEdit = currentUser?.role === 'gm' || currentUser?.role === 'admin';

  const [data, setData] = useState<TickerData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [items, setItems] = useState<Record<TickerItemKey, boolean> | null>(null);
  const [kursUsd, setKursUsd] = useState('');
  const [kursEur, setKursEur] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<TickerData>('/api/ticker'));
    } catch {
      // the ticker is decorative; a failed refresh keeps the last text
    }
  }, []);

  useEffect(() => {
    void load();
    const every = setInterval(load, 5 * 60 * 1000);
    const s = getSocket();
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 3000);
    };
    s.on('prospect:created', soon);
    s.on('prospect:updated', soon);
    s.on('prospect:deleted', soon);
    s.on('ticker:updated', load);
    return () => {
      clearInterval(every);
      if (timer.current) clearTimeout(timer.current);
      s.off('prospect:created', soon);
      s.off('prospect:updated', soon);
      s.off('prospect:deleted', soon);
      s.off('ticker:updated', load);
    };
  }, [load]);

  const personal = useMemo(() => (currentUser ? buildPersonalTicker(currentUser, prospects, salesPlans) : null), [currentUser, prospects, salesPlans]);
  const lines = useMemo(() => (data ? buildTickerLines(data, personal) : []), [data, personal]);

  function startEdit() {
    if (!data) return;
    setDraft(data.custom.messages.join('\n'));
    setItems({ ...data.custom.items });
    setKursUsd(dots(data.custom.kursManual.usd));
    setKursEur(dots(data.custom.kursManual.eur));
    setEditing(true);
  }

  async function save() {
    if (!items) return;
    setSaving(true);
    try {
      const messages = draft.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.put('/api/ticker', { enabled: items.custom, messages, items, kursManual: { usd: undot(kursUsd), eur: undot(kursEur) } });
      await load();
      setEditing(false);
      toast('Pengaturan running text disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan running text', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!data || (lines.length === 0 && !canEdit)) return null;
  // Speed scales with length so long text isn't unreadably fast.
  const text = lines.length ? lines.join('     •     ') : 'Running text kosong — klik ikon pensil untuk memilih item yang ditampilkan.';
  const seconds = Math.max(25, Math.round(text.length / 7));
  const onlineKurs = data.kurs && !data.kurs.source.startsWith('internal') ? data.kurs : null;

  return (
    <div className="running-text">
      <div className="rt-viewport" title="Arahkan kursor untuk menjeda">
        <div className="rt-track" style={{ animationDuration: `${seconds}s` }}>
          <span>{text}</span>
        </div>
      </div>
      {canEdit && (
        <button type="button" className="rt-edit" title="Atur isi running text" onClick={startEdit}>
          <IconEdit />
        </button>
      )}
      {editing && items && (
        <div className="rt-editor">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Pengaturan running text</div>
          <div className="field-note" style={{ marginBottom: 8 }}>
            Centang item yang ditampilkan. Berlaku untuk semua pengguna; pengingat pribadi dihitung dari data masing-masing.
          </div>
          <div className="rt-checklist">
            {GROUPS.map((g) => (
              <div key={g} className="rt-group">
                <div className="rt-group-title">{g}</div>
                {TICKER_ITEMS.filter((i) => i.group === g).map((i) => (
                  <label key={i.key} className="rt-check">
                    <input type="checkbox" checked={items[i.key]} onChange={(e) => setItems({ ...items, [i.key]: e.target.checked })} />
                    <span>
                      {i.label}
                      <small>{i.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          {(items.kursUsd || items.kursEur) && (
            <div style={{ marginTop: 10 }}>
              <div className="rt-group-title">Kurs manual (opsional)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="rt-kurs">
                  USD 1 = Rp
                  <input type="text" inputMode="numeric" value={kursUsd} onChange={(e) => setKursUsd(dots(undot(e.target.value)))} placeholder={onlineKurs?.usd ? dots(onlineKurs.usd) : 'otomatis'} />
                </label>
                <label className="rt-kurs">
                  EUR 1 = Rp
                  <input type="text" inputMode="numeric" value={kursEur} onChange={(e) => setKursEur(dots(undot(e.target.value)))} placeholder={onlineKurs?.eur ? dots(onlineKurs.eur) : 'otomatis'} />
                </label>
              </div>
              <div className="field-note">
                Kosongkan untuk memakai kurs referensi harian otomatis (Bank Sentral Eropa, cadangan open.er-api). Isi bila perusahaan memakai kurs internal.
              </div>
            </div>
          )}

          {items.custom && (
            <div style={{ marginTop: 10 }}>
              <div className="rt-group-title">Teks custom</div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={'Satu pesan per baris, cth.\nSelamat ulang tahun Pak Budi (BM SMG)!\nStock opname tanggal 30 Oktober.'}
                style={{ width: '100%', minHeight: 80 }}
              />
              <div className="field-note">Maks. {TICKER_MAX_MESSAGES} pesan, 300 karakter per pesan.</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>
              Batal
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
              Simpan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
