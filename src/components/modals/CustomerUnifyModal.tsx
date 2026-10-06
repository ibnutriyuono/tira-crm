'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { findNameGroups, type NameGroup, type NameSource } from '@/lib/customer-names';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const PAGE = 30;

/**
 * Satukan Nama Customer (GM/Admin): lists customers written several ways and
 * renames every record to one standard spelling. Spellings that are the same
 * company (case, dots, "PT" position) are pre-ticked; spellings that only
 * look similar (possible typos) are listed but left for the user to tick.
 */
export function CustomerUnifyModal() {
  const show = useUiStore((s) => s.modal === 'customerUnify');
  const openModal = useUiStore((s) => s.openModal);
  const close = () => openModal('customers');
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const bootstrap = useDataStore((s) => s.bootstrap);
  const toast = useDataStore((s) => s.toast);

  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busyKey, setBusyKey] = useState('');
  // Per group: chosen standard name and the spellings ticked to merge.
  const [target, setTarget] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, Record<string, boolean>>>({});

  const groups = useMemo(() => {
    const src: NameSource[] = [];
    customers.forEach((c) => c.name && src.push({ name: c.name, count: 0, master: true }));
    prospects.forEach((p) => p.customer && src.push({ name: p.customer, count: 1 }));
    rfqs.forEach((r) => r.customer && src.push({ name: r.customer, count: 1 }));
    fupas.forEach((f) => f.customer && src.push({ name: f.customer, count: 1 }));
    return findNameGroups(src);
  }, [customers, prospects, rfqs, fupas]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter((g) => g.variants.some((v) => v.name.toLowerCase().includes(q))) : groups;
  }, [groups, search]);

  const targetOf = (g: NameGroup) => target[g.key] ?? g.canonical;
  const isPicked = (g: NameGroup, name: string) => picked[g.key]?.[name] ?? !g.variants.find((v) => v.name === name)?.similarOnly;

  async function unify(g: NameGroup) {
    const to = targetOf(g).trim();
    const from = g.variants.filter((v) => isPicked(g, v.name) && v.name !== to).map((v) => v.name);
    if (!to) return toast('Nama baku wajib diisi', 'error');
    if (from.length === 0) return toast('Centang minimal satu ejaan lain untuk disatukan', 'error');
    if (!window.confirm(`Ubah ${from.length} ejaan berikut menjadi "${to}" di semua prospek, aktivitas, RFQ, FUP A, perjalanan dinas dan Kelola Customer?\n\n${from.map((f) => `• ${f}`).join('\n')}`)) return;
    setBusyKey(g.key);
    try {
      const r = await api.post<{ prospects: number; activities: number; rfqs: number; fupas: number; trips: number; mergedCustomers: number }>('/api/customers/unify', { to, from });
      toast(`Disatukan ke "${to}": ${r.prospects} prospek, ${r.activities} aktivitas, ${r.rfqs} RFQ, ${r.fupas} FUP A, ${r.trips} perjalanan${r.mergedCustomers ? `, ${r.mergedCustomers} customer ganda digabung` : ''}`, 'success');
      await bootstrap();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyatukan nama', 'error');
    } finally {
      setBusyKey('');
    }
  }

  return (
    <Modal show={show} onClose={close} title="Satukan Nama Customer" xwide footer={<button type="button" className="btn btn-outline" onClick={close}>Kembali ke Kelola Customer</button>}>
      <div className="import-summary" style={{ marginTop: 0 }}>
        Daftar customer yang ditulis dengan ejaan berbeda. Pilih <b>nama baku</b>, centang ejaan yang mau disatukan, lalu klik
        <b> Satukan</b> — semua prospek, aktivitas harian, RFQ, FUP A, perjalanan dinas dan data Kelola Customer ikut diganti, dan
        customer ganda digabung (PIC dijadikan satu). Ejaan yang sama persis selain huruf besar/kecil, titik dan posisi &quot;PT&quot;
        sudah dicentang; ejaan yang hanya <i>mirip</i> (kemungkinan salah ketik) tidak dicentang — cek dulu sebelum menyatukan.
      </div>
      <div className="toolbar-row" style={{ marginTop: 10 }}>
        <input type="search" className="search-grow" placeholder="Cari nama customer..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="field-note">{shown.length} kelompok nama</span>
      </div>
      {shown.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>Tidak ada nama ganda</h3>
          <p>{groups.length === 0 ? 'Semua customer sudah ditulis seragam.' : 'Coba kata kunci lain.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {shown.slice(0, limit).map((g) => {
            const to = targetOf(g);
            const n = g.variants.filter((v) => isPicked(g, v.name) && v.name !== to.trim()).length;
            return (
              <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <label style={{ margin: 0, fontSize: 11 }}>Nama baku</label>
                  <input type="text" value={to} onChange={(e) => setTarget((t) => ({ ...t, [g.key]: e.target.value }))} style={{ flex: '1 1 260px', fontWeight: 600 }} />
                  <span className="field-note">{g.total} data</span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyKey === g.key || n === 0} onClick={() => unify(g)}>
                    {busyKey === g.key ? 'Menyatukan…' : `Satukan ${n} ejaan`}
                  </button>
                </div>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <tbody>
                    {g.variants.map((v) => (
                      <tr key={v.name}>
                        <td style={{ width: 28 }}>
                          <input
                            type="checkbox"
                            checked={v.name === to.trim() || isPicked(g, v.name)}
                            disabled={v.name === to.trim()}
                            onChange={(e) => setPicked((p) => ({ ...p, [g.key]: { ...(p[g.key] || {}), [v.name]: e.target.checked } }))}
                          />
                        </td>
                        <td>
                          {v.name}
                          {v.master && <span className="badge slate" style={{ marginLeft: 6 }}>Kelola Customer</span>}
                          {v.similarOnly && <span className="badge amber" style={{ marginLeft: 6 }}>Mirip — cek dulu</span>}
                          {v.name === to.trim() && <span className="badge green" style={{ marginLeft: 6 }}>Nama baku</span>}
                        </td>
                        <td className="mono" style={{ width: 90, textAlign: 'right' }}>{v.count} data</td>
                        <td style={{ width: 120, textAlign: 'right' }}>
                          {v.name !== to.trim() && (
                            <button type="button" className="btn btn-outline btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setTarget((t) => ({ ...t, [g.key]: v.name }))}>
                              Jadikan baku
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {shown.length > limit && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
              Tampilkan {Math.min(PAGE, shown.length - limit)} kelompok lagi
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
