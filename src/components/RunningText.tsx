'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { getSocket } from '@/lib/socket-client';
import { TICKER_MAX_MESSAGES, type TickerData } from '@/lib/ticker';
import { useDataStore } from '@/store/useDataStore';
import { IconEdit } from './icons';

function bulanLabel(periode: string): string {
  const d = new Date(`${periode}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? periode : d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/**
 * Running text under the top bar: the month's largest PO (with its SE and
 * branch), the branch with the largest PO total, and GM/admin's own
 * messages. Refreshes when a prospect changes (debounced), when the messages
 * are edited, and every 5 minutes as a fallback.
 */
export function RunningText() {
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const canEdit = currentUser?.role === 'gm' || currentUser?.role === 'admin';

  const [data, setData] = useState<TickerData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [enabled, setEnabled] = useState(true);
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

  const items = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    const bln = bulanLabel(data.periode);
    if (data.topPo) {
      out.push(`🏆 PO terbesar ${bln}: ${data.topPo.customer} — ${formatRupiah(data.topPo.value)} · SE ${data.topPo.se} (cabang ${data.topPo.cabang}). Selamat!`);
    }
    if (data.topCabang) {
      out.push(`🏢 Cabang dengan total PO terbesar ${bln}: ${data.topCabang.cabang} — ${formatRupiah(data.topCabang.total)} dari ${data.topCabang.count} PO`);
    }
    if (!data.topPo && !data.topCabang) out.push(`Belum ada PO tercatat di ${bln} — ayo jadi yang pertama!`);
    if (data.custom.enabled) data.custom.messages.forEach((m) => out.push(`📣 ${m}`));
    return out;
  }, [data]);

  function startEdit() {
    setDraft((data?.custom.messages || []).join('\n'));
    setEnabled(data?.custom.enabled ?? true);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const messages = draft.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.put('/api/ticker', { enabled, messages });
      await load();
      setEditing(false);
      toast('Running text disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan running text', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!data || items.length === 0) return null;
  // Speed scales with length so long text isn't unreadably fast.
  const text = items.join('     •     ');
  const seconds = Math.max(25, Math.round(text.length / 7));

  return (
    <div className="running-text">
      <div className="rt-viewport" title="Arahkan kursor untuk menjeda">
        <div className="rt-track" style={{ animationDuration: `${seconds}s` }}>
          <span>{text}</span>
        </div>
      </div>
      {canEdit && (
        <button type="button" className="rt-edit" title="Ubah teks custom running text" onClick={startEdit}>
          <IconEdit />
        </button>
      )}
      {editing && (
        <div className="rt-editor">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Teks custom running text</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'Satu pesan per baris, cth.\nSelamat ulang tahun Pak Budi (BM SMG)!\nStock opname tanggal 30 Oktober.'}
            style={{ width: '100%', minHeight: 110 }}
          />
          <div className="field-note">Maks. {TICKER_MAX_MESSAGES} pesan, 300 karakter per pesan. PO terbesar & cabang terbaik tampil otomatis.</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0', textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 'auto' }} /> Tampilkan teks custom
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
