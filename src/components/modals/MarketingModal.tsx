'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconWa } from '../icons';
import { STAGE_PROBABILITY, STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, getProspectMaterials, normalizePhone, num, todayStr } from '@/lib/format';
import { buildCustomerIntel, type CustomerIntelRow } from '@/lib/reports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';

type Tab = 'reaktivasi' | 'kekalahan' | 'crosssell' | 'konten' | 'corong';

const TABS: { key: Tab; label: string }[] = [
  { key: 'reaktivasi', label: 'Reaktivasi' },
  { key: 'kekalahan', label: 'Analisa Kekalahan' },
  { key: 'crosssell', label: 'Peluang Cross-Sell' },
  { key: 'konten', label: 'Ide Konten Teknis' },
  { key: 'corong', label: 'Corong Konversi' },
];

/** Tags reactivation follow-ups so this screen can recognise its own entries. */
const ACTIVITY_TAG = '[Reaktivasi]';

function recordDate(r: Prospect): string {
  return r.tglDelivery || r.tglPO || r.statusChangedAt || r.createdAt || '';
}

/** Most recent thing this customer actually bought — the hook for the message. */
function lastWonItem(c: CustomerIntelRow): { uraian: string; date: string } | null {
  const won = c.records.filter((r) => classify(r) === 'Won').sort((a, b) => recordDate(b).localeCompare(recordDate(a)));
  return won[0] ? { uraian: won[0].uraian || '-', date: recordDate(won[0]) } : null;
}

function customerPhone(c: CustomerIntelRow): string {
  const withPhone = c.records.filter((r) => (r.phone || '').trim()).sort((a, b) => recordDate(b).localeCompare(recordDate(a)));
  return withPhone[0]?.phone || '';
}

function alreadyContacted(c: CustomerIntelRow): Prospect | null {
  const acts = c.records
    .filter((r) => num(r.status) === 0 && (r.keterangan || '').startsWith(ACTIVITY_TAG))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return acts[0] || null;
}

/** Lines a customer has actually bought (Won). */
function wonLines(records: Prospect[]): Set<string> {
  const out = new Set<string>();
  records
    .filter((r) => classify(r) === 'Won')
    .forEach((r) => getProspectMaterials(r).forEach((m) => m.line && out.add(m.line.trim())));
  return out;
}

export function MarketingModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'marketing';
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const [tab, setTab] = useState<Tab>('reaktivasi');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'dingin' | 'semua'>('dingin');
  const [busyId, setBusyId] = useState('');

  const intel = useMemo(() => buildCustomerIntel(prospects), [prospects]);

  // ---- 1. Reaktivasi ----
  const targets = useMemo(() => {
    let l = intel.filter((c) => (scope === 'dingin' ? c.health.startsWith('Dingin') : c.health.startsWith('Dingin') || c.health === 'Menghangat'));
    if (search.trim()) l = l.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
    // Ranked by historical value, not by how long they've been quiet — a big
    // account silent 4 months matters more than a small one silent a year.
    return [...l].sort((a, b) => b.wonValue - a.wonValue);
  }, [intel, scope, search]);

  const belumDihubungi = targets.filter((c) => !alreadyContacted(c));
  const potensiValue = belumDihubungi.reduce((s, c) => s + c.wonValue, 0);

  function buildMessage(c: CustomerIntelRow): string {
    const item = lastWonItem(c);
    const sapaan = `Selamat pagi Bapak/Ibu,\n\nSaya ${currentUser?.name || ''} dari PT Tira Austenite (Steel Division).`;
    const konteks = item
      ? `\n\nTerakhir kami suplai *${item.uraian}* pada ${formatDateID(item.date)}. Sudah ${c.daysSinceOrder} hari, jadi saya ingin menanyakan apakah ada kebutuhan material dalam waktu dekat?`
      : `\n\nSaya ingin menanyakan apakah ada kebutuhan material baja dalam waktu dekat?`;
    return sapaan + konteks + `\n\nKami siap bantu cek ketersediaan stok dan harga terbaik. Terima kasih.`;
  }

  function openWa(c: CustomerIntelRow) {
    const phone = normalizePhone(customerPhone(c));
    if (phone.length < 9) return toast(`Nomor WhatsApp ${c.name} belum ada di data prospek.`, 'error');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(c))}`, '_blank');
  }

  async function logContact(c: CustomerIntelRow) {
    const ref = c.records[0];
    setBusyId(c.name);
    try {
      const { prospect } = await api.post<{ prospect: Prospect }>('/api/prospects', {
        reg: ref?.reg ?? null,
        cabang: c.cabang,
        se: ref?.se || currentUser?.se || '',
        customer: c.name,
        phone: customerPhone(c),
        status: 0,
        materials: [{ line: ref?.line || '', uraian: 'Follow-up reaktivasi customer', qty: 1, harga: 0 }],
        kondisiStock: '',
        keterangan: `${ACTIVITY_TAG} Dihubungi ${formatDateID(todayStr())} oleh ${currentUser?.name || '-'} — terakhir order ${c.lastOrderDate ? formatDateID(c.lastOrderDate) : '-'} (${c.daysSinceOrder} hari lalu)`,
      });
      upsertProspect(prospect);
      toast(`Follow-up ${c.name} tercatat sebagai Sales Activity`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mencatat follow-up', 'error');
    } finally {
      setBusyId('');
    }
  }

  // ---- 2. Analisa Kekalahan ----
  const kekalahan = useMemo(() => {
    const lost = prospects.filter((r) => classify(r) === 'Lost');
    const byLine = new Map<string, { line: string; total: number; value: number; harga: number; quality: number; delivery: number; lain: number; kompetitor: Map<string, number> }>();
    lost.forEach((r) => {
      const lines = Array.from(new Set(getProspectMaterials(r).map((m) => (m.line || '').trim()).filter(Boolean)));
      (lines.length ? lines : ['(Tanpa Line)']).forEach((ln) => {
        if (!byLine.has(ln)) byLine.set(ln, { line: ln, total: 0, value: 0, harga: 0, quality: 0, delivery: 0, lain: 0, kompetitor: new Map() });
        const e = byLine.get(ln)!;
        e.total++;
        e.value += num(r.value);
        // QCD fields are free text, so reasons are classified by which field
        // is filled plus keyword matching, with 'lain' catching the rest so
        // the columns always reconcile to total.
        const blob = `${r.qcdCost || ''} ${r.qcdQuality || ''} ${r.qcdDelivery || ''}`.toLowerCase();
        if ((r.qcdCost || '').trim() || /harga|mahal|murah|cost/.test(blob)) e.harga++;
        else if ((r.qcdDelivery || '').trim() || /kirim|delivery|lama|indent|stok/.test(blob)) e.delivery++;
        else if ((r.qcdQuality || '').trim() || /kualitas|quality|spek|mutu/.test(blob)) e.quality++;
        else e.lain++;
        const k = (r.qcdKompetitor || '').trim();
        if (k) e.kompetitor.set(k, (e.kompetitor.get(k) || 0) + 1);
      });
    });
    return Array.from(byLine.values()).sort((a, b) => b.value - a.value);
  }, [prospects]);

  // ---- 3. Cross-sell ----
  const crossSell = useMemo(() => {
    const buyers = intel.filter((c) => c.won > 0);
    const linePopularity = new Map<string, number>();
    buyers.forEach((c) => wonLines(c.records).forEach((ln) => linePopularity.set(ln, (linePopularity.get(ln) || 0) + 1)));
    const allLines = Array.from(linePopularity.entries()).sort((a, b) => b[1] - a[1]);
    return buyers
      .map((c) => {
        const owned = wonLines(c.records);
        return { name: c.name, cabang: c.cabang, wonValue: c.wonValue, ownedCount: owned.size, owned: Array.from(owned), missing: allLines.filter(([ln]) => !owned.has(ln)).slice(0, 3), health: c.health, healthColor: c.healthColor };
      })
      .filter((c) => c.missing.length > 0 && c.ownedCount > 0)
      // Big spenders with narrow line coverage are the best bets.
      .sort((a, b) => b.wonValue / b.ownedCount - a.wonValue / a.ownedCount)
      .slice(0, 30);
  }, [intel]);

  // ---- 4. Ide konten ----
  const kontenIdeas = useMemo(() => {
    const lineValue = new Map<string, number>();
    prospects.filter((r) => classify(r) === 'Won').forEach((r) =>
      getProspectMaterials(r).forEach((m) => {
        const ln = (m.line || '').trim();
        if (ln) lineValue.set(ln, (lineValue.get(ln) || 0) + num(m.qty) * num(m.harga));
      }),
    );
    const ideas: { judul: string; alasan: string; sumber: string }[] = [];
    Array.from(lineValue.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([ln, val]) => ideas.push({ judul: `Panduan pemilihan grade untuk Line ${ln}`, alasan: `Line dengan nilai penjualan tertinggi (${formatRupiah(val)}). Customer yang sudah beli di sini paling mungkin membagikan materinya ke rekan seindustri.`, sumber: `Line ${ln}` }));
    kekalahan.slice(0, 3).forEach((k) => {
      if (k.delivery > k.harga) ideas.push({ judul: `Studi kasus: ketersediaan stok untuk Line ${k.line}`, alasan: `Di line ini kekalahan lebih sering karena delivery (${k.delivery}x) daripada harga (${k.harga}x) — konten soal kesiapan stok lebih relevan daripada bicara harga.`, sumber: `Line ${k.line}` });
      else if (k.harga > 0) ideas.push({ judul: `Analisa biaya total pemakaian — Line ${k.line}`, alasan: `Kekalahan didominasi harga (${k.harga}x). Konten yang membandingkan umur pakai vs harga beli bisa menggeser diskusi dari harga satuan ke biaya jangka panjang.`, sumber: `Line ${k.line}` });
    });
    const kompetitorTop = new Map<string, number>();
    prospects.filter((r) => classify(r) === 'Lost' && (r.qcdKompetitor || '').trim()).forEach((r) => {
      const k = r.qcdKompetitor!.trim();
      kompetitorTop.set(k, (kompetitorTop.get(k) || 0) + 1);
    });
    const topK = Array.from(kompetitorTop.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topK) ideas.push({ judul: `Materi pembanding teknis vs ${topK[0]}`, alasan: `Kompetitor yang paling sering menang (${topK[1]}x). Sales perlu bahan argumentasi teknis yang siap pakai saat berhadapan dengan mereka.`, sumber: 'Log Kompetitor' });
    return ideas;
  }, [prospects, kekalahan]);

  // ---- 5. Corong konversi ----
  const corong = useMemo(() => {
    const stages = [1, 2, 3, 4, 5];
    const reached = new Map<number, { count: number; value: number }>();
    stages.forEach((s) => reached.set(s, { count: 0, value: 0 }));
    prospects.forEach((r) => {
      const st = num(r.status);
      if (st === 0 || st === 6) return;
      stages.filter((s) => s <= st).forEach((s) => {
        const e = reached.get(s)!;
        e.count++;
        e.value += num(r.value);
      });
    });
    const rows = stages.map((s) => {
      const cur = reached.get(s)!;
      const prev = s > 1 ? reached.get(s - 1)! : null;
      return { stage: s, label: STATUS_META[s]?.label || String(s), count: cur.count, value: cur.value, konversi: prev && prev.count > 0 ? (cur.count / prev.count) * 100 : null, bocor: prev ? prev.count - cur.count : 0 };
    });
    return { rows, totalLost: prospects.filter((r) => classify(r) === 'Lost').length };
  }, [prospects]);

  async function exportReaktivasi() {
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['CUSTOMER', 'CABANG', 'ORDER TERAKHIR', 'HARI SEJAK ORDER', 'TOTAL NILAI PEMBELIAN', 'MATERIAL TERAKHIR', 'NO. WHATSAPP', 'SUDAH DIHUBUNGI']];
    targets.forEach((c) => {
      const contacted = alreadyContacted(c);
      aoa.push([c.name, c.cabang || '', c.lastOrderDate ? formatDateID(c.lastOrderDate) : '-', c.daysSinceOrder ?? '', c.wonValue, lastWonItem(c)?.uraian || '', customerPhone(c), contacted ? formatDateID((contacted.createdAt || '').slice(0, 10)) : 'Belum']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 30 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reaktivasi');
    XLSX.writeFile(wb, `Kampanye_Reaktivasi_${todayStr()}.xlsx`);
  }

  async function exportKekalahan() {
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['LINE', 'JUMLAH KALAH', 'NILAI HILANG', 'KALAH HARGA', 'KALAH DELIVERY', 'KALAH KUALITAS', 'LAIN-LAIN', 'KOMPETITOR UTAMA']];
    kekalahan.forEach((k) => {
      const topK = Array.from(k.kompetitor.entries()).sort((a, b) => b[1] - a[1])[0];
      aoa.push([k.line, k.total, k.value, k.harga, k.delivery, k.quality, k.lain, topK ? `${topK[0]} (${topK[1]}x)` : '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 13 }, { wch: 18 }, { wch: 13 }, { wch: 15 }, { wch: 15 }, { wch: 11 }, { wch: 26 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analisa Kekalahan');
    XLSX.writeFile(wb, `Analisa_Kekalahan_${todayStr()}.xlsx`);
  }

  async function exportCrossSell() {
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['CUSTOMER', 'CABANG', 'STATUS', 'TOTAL PEMBELIAN', 'LINE DIBELI', 'PELUANG CROSS-SELL']];
    crossSell.forEach((c) => aoa.push([c.name, c.cabang, c.health, c.wonValue, c.owned.join(', '), c.missing.map(([ln, n]) => `Line ${ln} (${n} customer lain beli)`).join('; ')]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 46 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cross-Sell');
    XLSX.writeFile(wb, `Peluang_CrossSell_${todayStr()}.xlsx`);
  }

  return (
    <Modal show={show} onClose={closeModal} title="Marketing" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="view-toggle" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reaktivasi' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Customer yang sudah lama tidak order, diurutkan dari <b>nilai pembelian terbesar</b> — bukan dari yang paling lama diam. Mereka sudah pernah beli dan kenal kualitas kita, jadi peluang tutupnya lebih tinggi daripada prospek baru.
          </div>
          <div className="kpi-grid" style={{ marginBottom: 18 }}>
            <div className="kpi rust">
              <div className="label">Perlu Dihubungi</div>
              <div className="value">{belumDihubungi.length}</div>
              <div className="foot">dari {targets.length} target</div>
            </div>
            <div className="kpi amber">
              <div className="label">Nilai Historis Belum Digarap</div>
              <div className="value" style={{ fontSize: 16 }}>{formatRupiah(potensiValue)}</div>
            </div>
            <div className="kpi green">
              <div className="label">Sudah Dihubungi</div>
              <div className="value">{targets.length - belumDihubungi.length}</div>
            </div>
          </div>
          <div className="toolbar-row">
            <button className="btn btn-outline btn-sm" onClick={exportReaktivasi}>
              <IconDownload /> Export Excel
            </button>
            <select className="btn-sm" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="dingin">Dingin saja (&gt;90 hari)</option>
              <option value="semua">Dingin + Menghangat (&gt;45 hari)</option>
            </select>
            <input type="search" className="search-grow" placeholder="Cari nama customer..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {targets.length === 0 ? (
            <div className="empty-state">
              <h3>Tidak ada customer yang perlu direaktivasi</h3>
              <p>Semua customer dalam cakupan Anda masih aktif order.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Cabang</th>
                    <th>Order Terakhir</th>
                    <th>Total Pembelian</th>
                    <th>Material Terakhir</th>
                    <th>Status Follow-up</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((c) => {
                    const contacted = alreadyContacted(c);
                    const phone = customerPhone(c);
                    return (
                      <tr key={c.name}>
                        <td>
                          <b>{c.name}</b>
                          {!phone && <div className="field-note">Nomor WA belum ada</div>}
                        </td>
                        <td>{c.cabang || '-'}</td>
                        <td>
                          {c.lastOrderDate ? formatDateID(c.lastOrderDate) : '-'}
                          <div className="field-note">{c.daysSinceOrder} hari lalu</div>
                        </td>
                        <td className="num">{formatRupiah(c.wonValue)}</td>
                        <td style={{ maxWidth: 220, whiteSpace: 'normal' }}>{lastWonItem(c)?.uraian || '-'}</td>
                        <td>{contacted ? <span className="badge green">Sudah {formatDateID((contacted.createdAt || '').slice(0, 10))}</span> : <span className="badge slate">Belum</span>}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-wa btn-sm" disabled={!phone} onClick={() => openWa(c)}>
                              <IconWa /> WhatsApp
                            </button>
                            <button type="button" className="btn btn-outline btn-sm" disabled={busyId === c.name} onClick={() => logContact(c)}>
                              Catat
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'kekalahan' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Kekalahan dipecah <b>per Line</b> beserta alasannya, supaya penanganannya bisa berbeda: line yang kalah karena harga perlu negosiasi ke prinsipal, sedangkan yang kalah karena delivery perlu stok buffer — bukan diskon.
          </div>
          <div className="toolbar-row">
            <button className="btn btn-outline btn-sm" onClick={exportKekalahan}>
              <IconDownload /> Export Excel
            </button>
          </div>
          {kekalahan.length === 0 ? (
            <div className="empty-state">
              <h3>Belum ada data kekalahan</h3>
              <p>Data muncul setelah prospek Lose Order diisi formulir QCD-nya.</p>
            </div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Kalah</th>
                  <th>Nilai Hilang</th>
                  <th>Harga</th>
                  <th>Delivery</th>
                  <th>Kualitas</th>
                  <th>Lain</th>
                  <th>Kompetitor Utama</th>
                  <th>Saran</th>
                </tr>
              </thead>
              <tbody>
                {kekalahan.map((k) => {
                  const topK = Array.from(k.kompetitor.entries()).sort((a, b) => b[1] - a[1])[0];
                  const saran = k.harga > k.delivery && k.harga > k.quality ? 'Nego harga / cari sumber lebih murah' : k.delivery > k.harga ? 'Perbaiki ketersediaan stok' : k.quality > 0 ? 'Perkuat argumentasi teknis' : 'Perlu isi QCD lebih lengkap';
                  return (
                    <tr key={k.line}>
                      <td><b>{k.line}</b></td>
                      <td className="num">{k.total}</td>
                      <td className="num">{formatRupiah(k.value)}</td>
                      <td className="num">{k.harga || '-'}</td>
                      <td className="num">{k.delivery || '-'}</td>
                      <td className="num">{k.quality || '-'}</td>
                      <td className="num">{k.lain || '-'}</td>
                      <td>{topK ? `${topK[0]} (${topK[1]}x)` : '-'}</td>
                      <td><span className="badge amber">{saran}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'crosssell' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Customer yang sudah beli tapi <b>line-nya masih sedikit</b>, dibandingkan line yang paling banyak dibeli customer lain. Diurutkan dari yang belanjanya besar tapi cakupan line-nya sempit.
          </div>
          <div className="toolbar-row">
            <button className="btn btn-outline btn-sm" onClick={exportCrossSell}>
              <IconDownload /> Export Excel
            </button>
          </div>
          {crossSell.length === 0 ? (
            <div className="empty-state">
              <h3>Belum ada peluang teridentifikasi</h3>
              <p>Butuh data penjualan (Won) dengan Line terisi untuk bisa membandingkan.</p>
            </div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Cabang</th>
                  <th>Status</th>
                  <th>Total Pembelian</th>
                  <th>Line Dibeli</th>
                  <th>Peluang Cross-Sell</th>
                </tr>
              </thead>
              <tbody>
                {crossSell.map((c) => (
                  <tr key={c.name}>
                    <td><b>{c.name}</b></td>
                    <td>{c.cabang || '-'}</td>
                    <td><span className={`badge ${c.healthColor}`}>{c.health}</span></td>
                    <td className="num">{formatRupiah(c.wonValue)}</td>
                    <td>{c.owned.join(', ') || '-'}</td>
                    <td>
                      {c.missing.map(([ln, n]) => (
                        <span key={ln} className="badge steel" style={{ marginRight: 4 }} title={`${n} customer lain membeli line ini`}>
                          Line {ln}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'konten' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Ide materi teknis yang diturunkan dari data Anda sendiri — line apa yang paling laku, dan di mana kita paling sering kalah. Untuk baja spesial, yang menentukan pilihan supplier sering bukan harga tapi <b>kepercayaan teknis</b>.
          </div>
          {kontenIdeas.length === 0 ? (
            <div className="empty-state">
              <h3>Belum cukup data</h3>
              <p>Ide konten diturunkan dari data penjualan dan QCD yang sudah terisi.</p>
            </div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th style={{ width: '32%' }}>Usulan Materi</th>
                  <th>Kenapa ini relevan</th>
                  <th>Sumber Data</th>
                </tr>
              </thead>
              <tbody>
                {kontenIdeas.map((k, i) => (
                  <tr key={i}>
                    <td><b>{k.judul}</b></td>
                    <td style={{ whiteSpace: 'normal' }}>{k.alasan}</td>
                    <td><span className="badge slate">{k.sumber}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'corong' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Berapa banyak prospek yang lolos dari satu tahap ke tahap berikutnya. Tahap dengan konversi terendah adalah titik bocor terbesar — di situ perbaikan paling berdampak, bukan di menambah prospek baru.
          </div>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Tahap</th>
                <th>Mencapai Tahap Ini</th>
                <th>Nilai</th>
                <th>Konversi dari Tahap Sebelumnya</th>
                <th>Bocor</th>
              </tr>
            </thead>
            <tbody>
              {corong.rows.map((r) => {
                const warna = r.konversi == null ? 'slate' : r.konversi >= 70 ? 'green' : r.konversi >= 40 ? 'amber' : 'rust';
                return (
                  <tr key={r.stage}>
                    <td>
                      <b>{r.stage} · {r.label}</b>
                      <div className="field-note">Bobot forecast {Math.round((STAGE_PROBABILITY[r.stage] || 0) * 100)}%</div>
                    </td>
                    <td className="num">{r.count}</td>
                    <td className="num">{formatRupiah(r.value)}</td>
                    <td>{r.konversi == null ? <span className="badge slate">—</span> : <span className={`badge ${warna}`}>{r.konversi.toFixed(0)}%</span>}</td>
                    <td className="num">{r.bocor > 0 ? `-${r.bocor}` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="field-note" style={{ marginTop: 10 }}>
            Total <b>{corong.totalLost}</b> prospek berakhir Lose Order. Data status tidak merekam di tahap mana prospek berhenti, jadi angka bocor per tahap dihitung dari selisih jumlah yang mencapai tiap tahap — bukan dari catatan kekalahan langsung.
          </div>
        </div>
      )}
    </Modal>
  );
}
