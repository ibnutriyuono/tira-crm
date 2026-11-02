'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LMap, LayerGroup } from 'leaflet';
import { ACTIVITY_LABEL } from '@/lib/constants';
import type { SalesActivity } from '@/lib/types';
import { useT } from '@/store/useLangStore';

/** Warna titik per jenis aktivitas (sama dengan grafik di tab Aktivitas). */
export const VISIT_COLORS: Record<string, string> = { kunjungan: '#2F8F5B', meeting: '#C47F2C', telepon: '#2F5576', dokumen: '#6B7684' };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Batas wilayah Indonesia — tampilan awal bila belum ada titik. */
const ID_BOUNDS: [[number, number], [number, number]] = [[-11, 94.5], [6.5, 141.5]];

/**
 * Peta Kunjungan: satu titik per aktivitas yang menyimpan lokasi GPS saat
 * dicatat (Tandai kunjungan di HP / laporan Tugas Kunjungan). Data sudah
 * tercakup sesuai role dari server. Peta OpenStreetMap (tanpa API key);
 * Leaflet dimuat hanya di browser.
 */
export function VisitMap({ points, height = 460 }: { points: SalesActivity[]; height?: number }) {
  const tr = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  // Buat peta sekali.
  useEffect(() => {
    let alive = true;
    void import('leaflet').then((L) => {
      if (!alive || !box.current || map.current) return;
      const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(m);
      m.fitBounds(ID_BOUNDS);
      // Gulir untuk zoom hanya setelah peta diklik (tidak mengganggu gulir halaman).
      m.on('click', () => m.scrollWheelZoom.enable());
      m.on('mouseout', () => m.scrollWheelZoom.disable());
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Gambar ulang titik saat filter berubah.
  const sig = useMemo(() => points.map((p) => p.id).join(','), [points]);
  useEffect(() => {
    if (!ready || !map.current || !layer.current) return;
    let alive = true;
    void import('leaflet').then((L) => {
      if (!alive || !map.current || !layer.current) return;
      layer.current.clearLayers();
      const coords: [number, number][] = [];
      points.forEach((a) => {
        if (a.lat == null || a.lng == null) return;
        const ll: [number, number] = [a.lat, a.lng];
        coords.push(ll);
        const color = VISIT_COLORS[a.tipe] || '#6B7684';
        const pics = (a.pics || []).map((p) => p.nama).filter(Boolean).join(', ');
        const html = `
          <div class="vm-pop">
            <b>${esc(a.customer)}</b>
            <div>${esc(a.tanggal)} · ${esc(ACTIVITY_LABEL[a.tipe] || a.tipe)} · SE ${esc(a.se)}${a.cabang ? ` · ${esc(a.cabang)}` : ''}</div>
            ${pics ? `<div>PIC: ${esc(pics)}</div>` : ''}
            ${a.keterangan ? `<div class="vm-ket">${esc(a.keterangan).slice(0, 300)}</div>` : ''}
            ${a.pendamping ? `<div>Didampingi ${esc(a.pendamping)}</div>` : ''}
            <a href="https://www.google.com/maps?q=${a.lat},${a.lng}" target="_blank" rel="noreferrer">Google Maps${a.akurasi ? ` (±${Math.round(a.akurasi)} m)` : ''}</a>
          </div>`;
        L.circleMarker(ll, { radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.9 }).bindPopup(html, { maxWidth: 300 }).addTo(layer.current!);
      });
      if (coords.length === 1) map.current.setView(coords[0], 13);
      else if (coords.length > 1) map.current.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 14 });
      else map.current.fitBounds(ID_BOUNDS);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig]);

  return (
    <div className="vm-wrap">
      <div ref={box} className="vm-map" style={{ height }} role="region" aria-label={tr('Peta kunjungan')} />
      <div className="vm-legend">
        {['kunjungan', 'meeting'].map((k) => (
          <span key={k}><i style={{ background: VISIT_COLORS[k] }} />{tr(ACTIVITY_LABEL[k] || k)}</span>
        ))}
        <span className="muted">{tr('Klik peta lalu gulir untuk zoom · klik titik untuk detail')}</span>
      </div>
    </div>
  );
}
