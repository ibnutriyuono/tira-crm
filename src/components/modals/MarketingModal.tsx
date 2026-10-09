'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconWa } from '../icons';
import { STAGE_PROBABILITY, STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, getProspectMaterials, materialsWithValue, normalizePhone, num, todayStr } from '@/lib/format';
import { buildCustomerIntel, type CustomerIntelRow } from '@/lib/reports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { activityLabel, buildContactIndex, lastContactAfter } from '@/lib/reaktivasi';
import { activityOwner } from '@/lib/sales-activity';
import type { Prospect, SalesActivity } from '@/lib/types';

type Tab = 'tren' | 'hitrate' | 'aktivitas' | 'reaktivasi' | 'kekalahan' | 'crosssell' | 'konten' | 'corong';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tren', label: 'Tren' },
  { key: 'hitrate', label: 'Penawaran vs PO' },
  { key: 'aktivitas', label: 'Aktivitas Sales' },
  { key: 'reaktivasi', label: 'Reaktivasi' },
  { key: 'kekalahan', label: 'Analisa Kekalahan' },
  { key: 'crosssell', label: 'Peluang Cross-Sell' },
  { key: 'konten', label: 'Ide Konten Teknis' },
  { key: 'corong', label: 'Corong Konversi' },
];

/** Tag of the old reactivation entries (saved as Sales Activity prospects before
 * this screen read Aktivitas Harian); still recognised so history isn't lost. */
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
  const toast = useDataStore((s) => s.toast);

  const [tab, setTab] = useState<Tab>('tren');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'dingin' | 'semua'>('dingin');
  const openModal = useUiStore((s) => s.openModal);
  const canLogActivity = !!currentUser && activityOwner(currentUser) !== null;
  // Aktivitas Harian (every month this role can see) -- what Reaktivasi reads
  // to know who was already contacted.
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [actLoaded, setActLoaded] = useState(false);
  const loadActivities = useCallback(async () => {
    try {
      setActivities((await api.get<{ activities: SalesActivity[] }>('/api/sales-activities?all=1')).activities);
    } catch {
      setActivities([]);
    } finally {
      setActLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (show && tab === 'reaktivasi') void loadActivities();
  }, [show, tab, loadActivities]);
  const contactIndex = useMemo(() => buildContactIndex(activities), [activities]);
  const [aktGran, setAktGran] = useState<'hari' | 'pekan' | 'bulan' | 'tahun'>('hari');
  const [aktSe, setAktSe] = useState('');
  const [aktJenis, setAktJenis] = useState('');
  const [aktSearch, setAktSearch] = useState('');
  const [aktPeriode, setAktPeriode] = useState('');

  const intel = useMemo(() => buildCustomerIntel(prospects), [prospects]);

  // ---- 1. Reaktivasi ----
  const targets = useMemo(() => {
    let l = intel.filter((c) => (scope === 'dingin' ? c.health.startsWith('Dingin') : c.health.startsWith('Dingin') || c.health === 'Menghangat'));
    if (search.trim()) l = l.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
    // Ranked by historical value, not by how long they've been quiet — a big
    // account silent 4 months matters more than a small one silent a year.
    return [...l].sort((a, b) => b.wonValue - a.wonValue);
  }, [intel, scope, search]);

  /** Latest contact after the last order: an Aktivitas Harian entry, else an old [Reaktivasi] note. */
  const contactOf = (c: CustomerIntelRow): { tanggal: string; act: SalesActivity | null } | null => {
    const act = lastContactAfter(contactIndex, c.name, c.lastOrderDate);
    if (act) return { tanggal: act.tanggal, act };
    const legacy = alreadyContacted(c);
    return legacy ? { tanggal: (legacy.createdAt || '').slice(0, 10), act: null } : null;
  };
  const belumDihubungi = targets.filter((c) => !contactOf(c));
  const potensiValue = belumDihubungi.reduce((s, c) => s + c.wonValue, 0);

  function buildMessage(c: CustomerIntelRow): string {
    const item = lastWonItem(c);
    const sapaan = `Selamat pagi Bapak/Ibu,\n\nSaya ${currentUser?.name || ''} dari PT Tira Austenite (Steel Division).`;
    const konteks = item
      ? `\n\nTerakhir kami suplai *${item.uraian}* pada ${formatDateID(item.date)}. Sudah ${c.daysSinceOrder} hari, jadi saya ingin menanyakan apakah ada kebutuhan material dalam waktu dekat?`
      : `\n\nSaya ingin menanyakan apakah ada kebutuhan material baja dalam waktu dekat?`;
    return sapaan + konteks + `\n\nKami siap bantu cek ketersediaan stok dan harga terbaik. Terima kasih.`;
  }

  async function openWa(c: CustomerIntelRow) {
    const phone = normalizePhone(customerPhone(c));
    if (phone.length < 9) return toast(`Nomor WhatsApp ${c.name} belum ada di data prospek.`, 'error');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(c))}`, '_blank');
    // The message going out is the contact: record it in Aktivitas Harian.
    try {
      const res = await api.post<{ logged: boolean }>('/api/follow-ups/done', { customerName: c.name, channel: 'WhatsApp (Reaktivasi)' });
      if (res.logged) {
        toast(`Follow-up ${c.name} tercatat di Aktivitas Harian`, 'success');
        void loadActivities();
      }
    } catch {
      // logging is best-effort; WhatsApp is already open
    }
  }

  /** Visit / call / meeting not done through WhatsApp: record it in Aktivitas Harian, customer filled in. */
  function logContact(c: CustomerIntelRow) {
    useUiStore.setState({
      activityPrefill: {
        customer: c.name,
        tipe: 'telepon',
        keterangan: `Reaktivasi — terakhir order ${c.lastOrderDate ? formatDateID(c.lastOrderDate) : '-'} (${c.daysSinceOrder} hari lalu). `,
        returnTo: 'marketing',
      },
    });
    openModal('salesActivity');
  }




  // ---- 0. Tren: 12 bulan terakhir + pergeseran per line ----
  const tren = useMemo(() => {
    // Anchor on tglPO/tglDelivery/tglPenawaran (same precedence lib/reports.ts
    // uses) rather than createdAt, so a prospect backdated on entry lands in
    // the month the business actually happened.
    const dateOf = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || (r.createdAt || '').slice(0, 10);
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const bulanan = months.map((m) => {
      const inMonth = prospects.filter((r) => (dateOf(r) || '').slice(0, 7) === m);
      const won = inMonth.filter((r) => classify(r) === 'Won');
      const lost = inMonth.filter((r) => classify(r) === 'Lost');
      const closed = won.length + lost.length;
      return {
        bulan: m,
        label: new Date(`${m}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
        wonValue: won.reduce((s, r) => s + num(r.value), 0),
        wonCount: won.length,
        lostCount: lost.length,
        winRate: closed > 0 ? (won.length / closed) * 100 : null,
        masuk: inMonth.length,
      };
    });

    // Momentum: rata-rata 3 bulan terakhir vs 3 bulan sebelumnya. Dibanding
    // membandingkan bulan-ke-bulan yang naik-turun karena satu deal besar.
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const akhir3 = bulanan.slice(-3);
    const sebelum3 = bulanan.slice(-6, -3);
    const nilaiAkhir = avg(akhir3.map((b) => b.wonValue));
    const nilaiSebelum = avg(sebelum3.map((b) => b.wonValue));
    const deltaNilai = nilaiSebelum > 0 ? ((nilaiAkhir - nilaiSebelum) / nilaiSebelum) * 100 : null;
    const wrAkhir = avg(akhir3.filter((b) => b.winRate != null).map((b) => b.winRate as number));
    const wrSebelum = avg(sebelum3.filter((b) => b.winRate != null).map((b) => b.winRate as number));

    // Line mana yang naik / turun, dengan basis periode yang sama.
    const lineIn = (ms: string[]) => {
      const map = new Map<string, number>();
      prospects
        .filter((r) => classify(r) === 'Won' && ms.includes((dateOf(r) || '').slice(0, 7)))
        .forEach((r) =>
          materialsWithValue(r).forEach((mt) => {
            const ln = (mt.line || '').trim();
            if (ln) map.set(ln, (map.get(ln) || 0) + mt.nilai);
          }),
        );
      return map;
    };
    const lnAkhir = lineIn(akhir3.map((b) => b.bulan));
    const lnSebelum = lineIn(sebelum3.map((b) => b.bulan));
    const perLine = Array.from(new Set([...lnAkhir.keys(), ...lnSebelum.keys()]))
      .map((ln) => {
        const a = lnAkhir.get(ln) || 0;
        const b = lnSebelum.get(ln) || 0;
        return { line: ln, akhir: a, sebelum: b, delta: b > 0 ? ((a - b) / b) * 100 : a > 0 ? null : 0 };
      })
      .sort((x, y) => y.akhir - x.akhir);

    const maxVal = Math.max(...bulanan.map((b) => b.wonValue), 1);
    return { bulanan, maxVal, deltaNilai, nilaiAkhir, nilaiSebelum, wrAkhir, wrSebelum, perLine };
  }, [prospects]);


  // ---- Penawaran vs PO per Line ----
  const hitRate = useMemo(() => {
    // "Penawaran" = prospek yang sudah sampai tahap penawaran harga ke atas
    // (status >= 2) atau yang ditandai penawaranTerkirim. Prospek yang masih
    // di tahap Permintaan belum pernah ditawar, jadi memasukkannya akan
    // menekan hit rate secara keliru.
    const ditawarkan = prospects.filter((r) => classify(r) !== 'Activity' && (num(r.status) >= 2 || r.penawaranTerkirim));
    const map = new Map<string, { line: string; nPenawaran: number; vPenawaran: number; nPo: number; vPo: number; nLost: number; vLost: number }>();
    const touch = (ln: string) => {
      if (!map.has(ln)) map.set(ln, { line: ln, nPenawaran: 0, vPenawaran: 0, nPo: 0, vPo: 0, nLost: 0, vLost: 0 });
      return map.get(ln)!;
    };
    ditawarkan.forEach((r) => {
      const klas = classify(r);
      // Nilai dihitung per baris material supaya sebuah prospek multi-line
      // tidak dihitung penuh di setiap line-nya.
      materialsWithValue(r).forEach((mt) => {
        const ln = (mt.line || '').trim() || '(Tanpa Line)';
        const nilai = mt.nilai;
        const e = touch(ln);
        e.nPenawaran++;
        e.vPenawaran += nilai;
        if (klas === 'Won') {
          e.nPo++;
          e.vPo += nilai;
        } else if (klas === 'Lost') {
          e.nLost++;
          e.vLost += nilai;
        }
      });
    });
    return Array.from(map.values())
      .map((e) => {
        const selesai = e.nPo + e.nLost;
        return {
          ...e,
          // Hit rate dihitung dari yang sudah selesai (PO atau kalah) saja —
          // penawaran yang masih berjalan belum punya hasil, memasukkannya
          // membuat angkanya selalu terlihat buruk.
          hitCount: selesai > 0 ? (e.nPo / selesai) * 100 : null,
          hitValue: e.vPo + e.vLost > 0 ? (e.vPo / (e.vPo + e.vLost)) * 100 : null,
          berjalan: e.nPenawaran - selesai,
        };
      })
      .sort((a, b) => b.vPenawaran - a.vPenawaran);
  }, [prospects]);

  const hitTotal = useMemo(() => {
    const vPenawaran = hitRate.reduce((s, l) => s + l.vPenawaran, 0);
    const vPo = hitRate.reduce((s, l) => s + l.vPo, 0);
    const vLost = hitRate.reduce((s, l) => s + l.vLost, 0);
    return { vPenawaran, vPo, vLost, hit: vPo + vLost > 0 ? (vPo / (vPo + vLost)) * 100 : null };
  }, [hitRate]);


  // ---- Aktivitas Sales ----
  // Setiap prospek bisa menghasilkan beberapa "kejadian" pada tanggal
  // berbeda (dibuat, ditawar, dapat PO, dikirim). Dipecah jadi event
  // terpisah supaya hitungan harian mencerminkan aktivitas yang benar-benar
  // terjadi hari itu, bukan sekadar jumlah prospek.
  const aktivitas = useMemo(() => {
    type Ev = { tanggal: string; jenis: string; warna: string; se: string; cabang: string; customer: string; nilai: number; catatan: string };
    const evs: Ev[] = [];
    prospects.forEach((r) => {
      const base = { se: (r.se || '-').trim() || '-', cabang: r.cabang || '-', customer: r.customer || '-', nilai: num(r.value) };
      if (num(r.status) === 0) {
        evs.push({ ...base, tanggal: (r.tglPenawaran || (r.createdAt || '').slice(0, 10)) || '', jenis: 'Kunjungan / Aktivitas', warna: 'slate', catatan: r.keterangan || r.uraian || '' });
      } else {
        const dibuat = (r.createdAt || '').slice(0, 10);
        if (dibuat) evs.push({ ...base, tanggal: dibuat, jenis: 'Prospek Baru', warna: 'steel', catatan: r.uraian || '' });
        if (r.tglPenawaran) evs.push({ ...base, tanggal: r.tglPenawaran, jenis: 'Penawaran Dikirim', warna: 'amber', catatan: r.uraian || '' });
        if (r.tglPO) evs.push({ ...base, tanggal: r.tglPO, jenis: 'Dapat PO', warna: 'green', catatan: r.uraian || '' });
        if (r.tglDelivery) evs.push({ ...base, tanggal: r.tglDelivery, jenis: 'Delivery', warna: 'green', catatan: r.uraian || '' });
        if (classify(r) === 'Lost') evs.push({ ...base, tanggal: (r.statusChangedAt || r.createdAt || '').slice(0, 10), jenis: 'Lose Order', warna: 'rust', catatan: r.qcdKompetitor ? `Kalah dari ${r.qcdKompetitor}` : r.keterangan || '' });
      }
    });
    return evs.filter((e) => e.tanggal).sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [prospects]);

  /** ISO week key, so weekly grouping doesn't drift across year boundaries. */
  function pekanKey(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-P${String(week).padStart(2, '0')}`;
  }

  const aktivitasFiltered = useMemo(() => {
    let l = aktivitas;
    if (aktSe) l = l.filter((e) => e.se === aktSe);
    if (aktJenis) l = l.filter((e) => e.jenis === aktJenis);
    if (aktSearch.trim()) l = l.filter((e) => e.customer.toLowerCase().includes(aktSearch.toLowerCase()));
    return l;
  }, [aktivitas, aktSe, aktJenis, aktSearch]);

  const aktivitasPeriode = useMemo(() => {
    const keyOf = (t: string) => (aktGran === 'hari' ? t : aktGran === 'pekan' ? pekanKey(t) : aktGran === 'bulan' ? t.slice(0, 7) : t.slice(0, 4));
    const map = new Map<string, { key: string; total: number; perJenis: Map<string, number>; customers: Set<string>; se: Set<string>; nilaiPo: number }>();
    aktivitasFiltered.forEach((e) => {
      const k = keyOf(e.tanggal);
      if (!map.has(k)) map.set(k, { key: k, total: 0, perJenis: new Map(), customers: new Set(), se: new Set(), nilaiPo: 0 });
      const g = map.get(k)!;
      g.total++;
      g.perJenis.set(e.jenis, (g.perJenis.get(e.jenis) || 0) + 1);
      g.customers.add(e.customer);
      g.se.add(e.se);
      if (e.jenis === 'Dapat PO') g.nilaiPo += e.nilai;
    });
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [aktivitasFiltered, aktGran]);

  const periodeAktif = aktPeriode || aktivitasPeriode[0]?.key || '';
  const detailPeriode = useMemo(() => {
    const keyOf = (t: string) => (aktGran === 'hari' ? t : aktGran === 'pekan' ? pekanKey(t) : aktGran === 'bulan' ? t.slice(0, 7) : t.slice(0, 4));
    return aktivitasFiltered.filter((e) => keyOf(e.tanggal) === periodeAktif);
  }, [aktivitasFiltered, aktGran, periodeAktif]);

  const seOptions = useMemo(() => Array.from(new Set(aktivitas.map((e) => e.se))).sort(), [aktivitas]);
  const jenisOptions = useMemo(() => Array.from(new Set(aktivitas.map((e) => e.jenis))).sort(), [aktivitas]);

  function labelPeriode(k: string): string {
    if (aktGran === 'hari') return formatDateID(k);
    if (aktGran === 'pekan') return k.replace('-P', ' Pekan ');
    if (aktGran === 'bulan') return new Date(`${k}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return k;
  }

  async function exportAktivitas() {
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['TANGGAL', 'PERIODE', 'JENIS AKTIVITAS', 'SE', 'CABANG', 'CUSTOMER', 'NILAI', 'CATATAN']];
    const keyOf = (t: string) => (aktGran === 'hari' ? t : aktGran === 'pekan' ? pekanKey(t) : aktGran === 'bulan' ? t.slice(0, 7) : t.slice(0, 4));
    aktivitasFiltered.forEach((e) => aoa.push([formatDateID(e.tanggal), labelPeriode(keyOf(e.tanggal)), e.jenis, e.se, e.cabang, e.customer, e.nilai, e.catatan]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 28 }, { wch: 16 }, { wch: 34 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Aktivitas Sales');
    XLSX.writeFile(wb, `Aktivitas_Sales_${todayStr()}.xlsx`);
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
      materialsWithValue(r).forEach((m) => {
        const ln = (m.line || '').trim();
        if (ln) lineValue.set(ln, (lineValue.get(ln) || 0) + m.nilai);
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
    const aoa: unknown[][] = [['CUSTOMER', 'CABANG', 'ORDER TERAKHIR', 'HARI SEJAK ORDER', 'TOTAL NILAI PEMBELIAN', 'MATERIAL TERAKHIR', 'NO. WHATSAPP', 'SUDAH DIHUBUNGI', 'JENIS KONTAK', 'SE', 'KETERANGAN AKTIVITAS']];
    targets.forEach((c) => {
      const k = contactOf(c);
      aoa.push([
        c.name, c.cabang || '', c.lastOrderDate ? formatDateID(c.lastOrderDate) : '-', c.daysSinceOrder ?? '', c.wonValue, lastWonItem(c)?.uraian || '', customerPhone(c),
        k ? formatDateID(k.tanggal) : 'Belum', k?.act ? activityLabel(k.act.tipe) : '', k?.act?.se || '', k?.act?.keterangan || '',
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 44 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reaktivasi');
    XLSX.writeFile(wb, `Kampanye_Reaktivasi_${todayStr()}.xlsx`);
  }

  async function exportHitRate() {
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['LINE', 'JML PENAWARAN', 'NILAI PENAWARAN', 'JML DAPAT PO', 'NILAI PO', 'JML KALAH', 'NILAI KALAH', 'MASIH BERJALAN', 'HIT RATE (JUMLAH)', 'HIT RATE (NILAI)']];
    hitRate.forEach((l) =>
      aoa.push([l.line, l.nPenawaran, l.vPenawaran, l.nPo, l.vPo, l.nLost, l.vLost, l.berjalan, l.hitCount == null ? '' : `${l.hitCount.toFixed(0)}%`, l.hitValue == null ? '' : `${l.hitValue.toFixed(0)}%`]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 18 }, { wch: 11 }, { wch: 18 }, { wch: 15 }, { wch: 17 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Penawaran vs PO');
    XLSX.writeFile(wb, `Penawaran_vs_PO_${todayStr()}.xlsx`);
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

      {tab === 'tren' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Arah pergerakan 12 bulan terakhir. Perbandingan memakai <b>rata-rata 3 bulan terakhir vs 3 bulan sebelumnya</b>, bukan bulan-ke-bulan — supaya satu deal besar tidak membuat kesimpulannya menyesatkan.
          </div>

          <div className="kpi-grid" style={{ marginBottom: 18 }}>
            <div className={`kpi ${tren.deltaNilai == null ? 'slate' : tren.deltaNilai >= 0 ? 'green' : 'rust'}`}>
              <div className="label">Momentum Nilai Won</div>
              <div className="value" style={{ fontSize: 20 }}>
                {tren.deltaNilai == null ? '—' : `${tren.deltaNilai >= 0 ? '▲' : '▼'} ${Math.abs(tren.deltaNilai).toFixed(0)}%`}
              </div>
              <div className="foot">3 bulan terakhir vs sebelumnya</div>
            </div>
            <div className="kpi steel">
              <div className="label">Rata-rata Won / Bulan</div>
              <div className="value" style={{ fontSize: 16 }}>{formatRupiah(tren.nilaiAkhir)}</div>
              <div className="foot">sebelumnya {formatRupiah(tren.nilaiSebelum)}</div>
            </div>
            <div className={`kpi ${tren.wrAkhir >= tren.wrSebelum ? 'green' : 'amber'}`}>
              <div className="label">Win Rate</div>
              <div className="value">{tren.wrAkhir.toFixed(0)}%</div>
              <div className="foot">sebelumnya {tren.wrSebelum.toFixed(0)}%</div>
            </div>
          </div>

          <div style={{ fontWeight: 600, fontSize: '12.5px', margin: '18px 0 8px' }}>Nilai Won per Bulan</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, padding: '0 2px 4px', borderBottom: '1px solid var(--border)' }}>
            {tren.bulanan.map((b) => (
              <div key={b.bulan} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }} title={`${b.label}: ${formatRupiah(b.wonValue)} · ${b.wonCount} Won, ${b.lostCount} Lost`}>
                <div style={{ fontSize: 9, color: 'var(--text-soft)', whiteSpace: 'nowrap' }}>{b.wonCount || ''}</div>
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max((b.wonValue / tren.maxVal) * 110, b.wonValue > 0 ? 3 : 0)}px`,
                    background: 'var(--steel-500)',
                    borderRadius: '3px 3px 0 0',
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '4px 2px 0' }}>
            {tren.bulanan.map((b) => (
              <div key={b.bulan} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: 'var(--text-soft)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {b.label}
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 600, fontSize: '12.5px', margin: '22px 0 8px' }}>Rincian per Bulan</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Bulan</th>
                  <th>Prospek Masuk</th>
                  <th>Won</th>
                  <th>Lost</th>
                  <th>Win Rate</th>
                  <th>Nilai Won</th>
                </tr>
              </thead>
              <tbody>
                {[...tren.bulanan].reverse().map((b) => (
                  <tr key={b.bulan}>
                    <td><b>{b.label}</b></td>
                    <td className="num">{b.masuk || '-'}</td>
                    <td className="num">{b.wonCount || '-'}</td>
                    <td className="num">{b.lostCount || '-'}</td>
                    <td>{b.winRate == null ? <span className="badge slate">—</span> : <span className={`badge ${b.winRate >= 50 ? 'green' : b.winRate >= 25 ? 'amber' : 'rust'}`}>{b.winRate.toFixed(0)}%</span>}</td>
                    <td className="num">{formatRupiah(b.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontWeight: 600, fontSize: '12.5px', margin: '22px 0 8px' }}>Pergeseran per Line</div>
          {tren.perLine.length === 0 ? (
            <div className="field-note">Belum cukup data penjualan dengan Line terisi.</div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>3 Bulan Terakhir</th>
                  <th>3 Bulan Sebelumnya</th>
                  <th>Perubahan</th>
                  <th>Baca</th>
                </tr>
              </thead>
              <tbody>
                {tren.perLine.map((l) => {
                  const naik = l.delta != null && l.delta > 10;
                  const turun = l.delta != null && l.delta < -10;
                  return (
                    <tr key={l.line}>
                      <td><b>{l.line}</b></td>
                      <td className="num">{formatRupiah(l.akhir)}</td>
                      <td className="num">{formatRupiah(l.sebelum)}</td>
                      <td>
                        {l.delta == null ? (
                          <span className="badge steel">Baru muncul</span>
                        ) : (
                          <span className={`badge ${naik ? 'green' : turun ? 'rust' : 'slate'}`}>
                            {l.delta >= 0 ? '▲' : '▼'} {Math.abs(l.delta).toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {l.delta == null
                          ? 'Line ini baru terjual di periode terakhir — layak dilihat apakah bisa didorong lebih jauh.'
                          : naik
                            ? 'Sedang tumbuh. Cocok jadi fokus cross-sell dan materi teknis.'
                            : turun
                              ? 'Menurun. Cek tab Analisa Kekalahan untuk line ini — apakah kalah harga atau delivery.'
                              : 'Relatif stabil.'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="field-note" style={{ marginTop: 12 }}>
            Bulan diambil dari Tgl PO / Tgl Delivery / Tgl Penawaran (urutan yang sama dipakai laporan lain), bukan dari tanggal input — jadi prospek yang dicatat mundur tetap masuk ke bulan yang benar.
          </div>
        </div>
      )}

      {tab === 'hitrate' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Perbandingan <b>penawaran yang keluar</b> dengan <b>PO yang benar-benar didapat</b>, dipecah per Line. Nilai dihitung per baris material, jadi prospek yang berisi beberapa line tidak dihitung penuh di masing-masing line. Hit rate dihitung dari penawaran yang <b>sudah ada hasilnya</b> (dapat PO atau kalah) — penawaran yang masih berjalan tidak ikut, supaya angkanya tidak terlihat buruk hanya karena banyak yang belum diputuskan.
          </div>

          <div className="kpi-grid" style={{ marginBottom: 18 }}>
            <div className="kpi steel">
              <div className="label">Total Nilai Penawaran</div>
              <div className="value" style={{ fontSize: 16 }}>{formatRupiah(hitTotal.vPenawaran)}</div>
            </div>
            <div className="kpi green">
              <div className="label">Nilai Jadi PO</div>
              <div className="value" style={{ fontSize: 16 }}>{formatRupiah(hitTotal.vPo)}</div>
            </div>
            <div className="kpi rust">
              <div className="label">Nilai Kalah</div>
              <div className="value" style={{ fontSize: 16 }}>{formatRupiah(hitTotal.vLost)}</div>
            </div>
            <div className={`kpi ${hitTotal.hit == null ? 'slate' : hitTotal.hit >= 50 ? 'green' : hitTotal.hit >= 25 ? 'amber' : 'rust'}`}>
              <div className="label">Hit Rate Keseluruhan</div>
              <div className="value">{hitTotal.hit == null ? '—' : `${hitTotal.hit.toFixed(0)}%`}</div>
              <div className="foot">berdasarkan nilai</div>
            </div>
          </div>

          <div className="toolbar-row">
            <button className="btn btn-outline btn-sm" onClick={exportHitRate}>
              <IconDownload /> Export Excel
            </button>
          </div>

          {hitRate.length === 0 ? (
            <div className="empty-state">
              <h3>Belum ada penawaran tercatat</h3>
              <p>Data muncul setelah ada prospek yang mencapai tahap Penawaran Harga.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Nilai Penawaran</th>
                    <th>Nilai Dapat PO</th>
                    <th>Nilai Kalah</th>
                    <th>Masih Berjalan</th>
                    <th>Hit Rate (Nilai)</th>
                    <th>Hit Rate (Jumlah)</th>
                    <th>Baca</th>
                  </tr>
                </thead>
                <tbody>
                  {hitRate.map((l) => {
                    const hv = l.hitValue;
                    const warna = hv == null ? 'slate' : hv >= 50 ? 'green' : hv >= 25 ? 'amber' : 'rust';
                    const baca =
                      hv == null
                        ? 'Belum ada penawaran yang selesai di line ini.'
                        : hv >= 50
                          ? 'Kuat. Line ini layak didorong lebih banyak penawaran.'
                          : hv >= 25
                            ? 'Sedang. Cek tab Analisa Kekalahan untuk tahu penyebab kalahnya.'
                            : 'Rendah. Banyak penawaran keluar tapi sedikit yang jadi — perlu evaluasi harga atau kesiapan stok.';
                    return (
                      <tr key={l.line}>
                        <td><b>{l.line}</b></td>
                        <td className="num">
                          {formatRupiah(l.vPenawaran)}
                          <div className="field-note">{l.nPenawaran} item</div>
                        </td>
                        <td className="num">
                          {formatRupiah(l.vPo)}
                          <div className="field-note">{l.nPo} item</div>
                        </td>
                        <td className="num">
                          {formatRupiah(l.vLost)}
                          <div className="field-note">{l.nLost} item</div>
                        </td>
                        <td className="num">{l.berjalan || '-'}</td>
                        <td>{hv == null ? <span className="badge slate">—</span> : <span className={`badge ${warna}`}>{hv.toFixed(0)}%</span>}</td>
                        <td>{l.hitCount == null ? <span className="badge slate">—</span> : <span className="badge slate">{l.hitCount.toFixed(0)}%</span>}</td>
                        <td style={{ whiteSpace: 'normal' }}>{baca}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="field-note" style={{ marginTop: 12 }}>
            Yang dihitung sebagai &quot;penawaran&quot; adalah prospek yang sudah mencapai tahap Penawaran Harga ke atas, atau yang ditandai penawarannya sudah terkirim. Prospek yang masih di tahap Permintaan belum pernah ditawar, jadi tidak ikut dihitung.
          </div>
        </div>
      )}

      {tab === 'aktivitas' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Semua jejak aktivitas Sales, dikelompokkan per <b>hari / pekan / bulan / tahun</b>. Satu prospek bisa menghasilkan beberapa aktivitas di tanggal berbeda (dibuat, ditawar, dapat PO, dikirim) — semuanya dicatat terpisah supaya hitungan harian mencerminkan yang benar-benar dikerjakan hari itu, bukan sekadar jumlah prospek.
          </div>

          <div className="toolbar-row">
            <button className="btn btn-outline btn-sm" onClick={exportAktivitas}>
              <IconDownload /> Export Excel
            </button>
            <select className="btn-sm" value={aktGran} onChange={(e) => { setAktGran(e.target.value as typeof aktGran); setAktPeriode(''); }}>
              <option value="hari">Per Hari</option>
              <option value="pekan">Per Pekan</option>
              <option value="bulan">Per Bulan</option>
              <option value="tahun">Per Tahun</option>
            </select>
            <select className="btn-sm" value={aktSe} onChange={(e) => setAktSe(e.target.value)}>
              <option value="">Semua SE</option>
              {seOptions.map((se) => (
                <option key={se} value={se}>{se}</option>
              ))}
            </select>
            <select className="btn-sm" value={aktJenis} onChange={(e) => setAktJenis(e.target.value)}>
              <option value="">Semua Jenis</option>
              {jenisOptions.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
            <input type="search" className="search-grow" placeholder="Cari customer..." value={aktSearch} onChange={(e) => setAktSearch(e.target.value)} />
          </div>
          <div className="count-line">
            <b>{aktivitasFiltered.length}</b> aktivitas dalam <b>{aktivitasPeriode.length}</b> periode
          </div>

          {aktivitasPeriode.length === 0 ? (
            <div className="empty-state">
              <h3>Belum ada aktivitas</h3>
              <p>Aktivitas terbentuk otomatis dari data prospek: dibuat, ditawar, dapat PO, dikirim, atau dicatat sebagai kunjungan.</p>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: '12.5px', margin: '18px 0 8px' }}>Ringkasan per Periode</div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th>Total Aktivitas</th>
                      <th>Customer</th>
                      <th>SE Aktif</th>
                      <th>Rincian</th>
                      <th>Nilai PO</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {aktivitasPeriode.map((g) => (
                      <tr key={g.key} style={g.key === periodeAktif ? { background: 'var(--steel-100)' } : undefined}>
                        <td><b>{labelPeriode(g.key)}</b></td>
                        <td className="num">{g.total}</td>
                        <td className="num">{g.customers.size}</td>
                        <td className="num">{g.se.size}</td>
                        <td>
                          {Array.from(g.perJenis.entries()).map(([j, n]) => (
                            <span key={j} className="badge slate" style={{ marginRight: 4 }}>{j}: {n}</span>
                          ))}
                        </td>
                        <td className="num">{g.nilaiPo > 0 ? formatRupiah(g.nilaiPo) : '-'}</td>
                        <td>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAktPeriode(g.key)}>
                            Lihat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 600, fontSize: '12.5px', margin: '22px 0 8px' }}>
                Rincian Aktivitas — {labelPeriode(periodeAktif)} <span style={{ fontWeight: 400, color: 'var(--text-soft)' }}>({detailPeriode.length} aktivitas)</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Jenis</th>
                      <th>SE</th>
                      <th>Cabang</th>
                      <th>Customer</th>
                      <th>Nilai</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailPeriode.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="field-note">Tidak ada aktivitas pada periode ini.</td>
                      </tr>
                    ) : (
                      detailPeriode.map((e, i) => (
                        <tr key={i}>
                          <td className="mono">{formatDateID(e.tanggal)}</td>
                          <td><span className={`badge ${e.warna}`}>{e.jenis}</span></td>
                          <td>{e.se}</td>
                          <td>{e.cabang}</td>
                          <td><b>{e.customer}</b></td>
                          <td className="num">{e.nilai > 0 ? formatRupiah(e.nilai) : '-'}</td>
                          <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{e.catatan || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="field-note" style={{ marginTop: 12 }}>
            Tanggal tiap aktivitas diambil dari tanggal kejadiannya masing-masing (Tgl Penawaran untuk penawaran, Tgl PO untuk PO, dan seterusnya) — bukan dari tanggal input, supaya prospek yang dicatat mundur tetap jatuh di hari yang benar.
          </div>
        </div>
      )}

      {tab === 'reaktivasi' && (
        <div>
          <div className="import-summary" style={{ marginBottom: 14 }}>
            Customer yang sudah lama tidak order, diurutkan dari <b>nilai pembelian terbesar</b> — bukan dari yang paling lama diam. Mereka sudah pernah beli dan kenal kualitas kita, jadi peluang tutupnya lebih tinggi daripada prospek baru.
            Status follow-up dibaca dari <b>Aktivitas Harian</b>: customer dianggap sudah dihubungi bila ada aktivitas (kunjungan, telepon/WA, meeting, dokumen) setelah order terakhirnya.
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
                    const k = contactOf(c);
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
                        <td style={{ maxWidth: 240, whiteSpace: 'normal' }}>
                          {k ? (
                            <>
                              <span className="badge green">Sudah {formatDateID(k.tanggal)}</span>
                              {k.act ? (
                                <div className="field-note" style={{ marginTop: 3 }}>
                                  {activityLabel(k.act.tipe)} · SE {k.act.se}
                                  {k.act.keterangan && <div title={k.act.keterangan}>{k.act.keterangan.length > 90 ? `${k.act.keterangan.slice(0, 90)}…` : k.act.keterangan}</div>}
                                </div>
                              ) : (
                                <div className="field-note" style={{ marginTop: 3 }}>catatan lama</div>
                              )}
                            </>
                          ) : (
                            <span className="badge slate">{actLoaded ? 'Belum' : '…'}</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-wa btn-sm" disabled={!phone} onClick={() => openWa(c)}>
                              <IconWa /> WhatsApp
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={!canLogActivity}
                              title={canLogActivity ? 'Catat kunjungan / telepon / meeting ke Aktivitas Harian' : 'Pencatatan aktivitas hanya untuk Sales dan BM'}
                              onClick={() => logContact(c)}
                            >
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
