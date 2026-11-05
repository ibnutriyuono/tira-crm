'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import type { StockMeta, StockRow } from '@/lib/stock';

/**
 * Stok gudang untuk saran harga di form material (GET /api/stock, tanpa HPP).
 * Disimpan sekali per halaman, diambil ulang paling cepat tiap 10 menit atau
 * segera setelah Admin mengunggah data baru (event socket 'stock:updated').
 */
export interface StockData {
  meta: StockMeta | null;
  marginPct: number;
  items: StockRow[];
}

const EMPTY: StockData = { meta: null, marginPct: 35, items: [] };
let cached: { at: number; data: StockData } | null = null;
let pending: Promise<StockData> | null = null;
const FRESH = 10 * 60 * 1000;
const subs = new Set<(d: StockData) => void>();
let socketBound = false;

function load(force = false): Promise<StockData> {
  if (!force && cached && Date.now() - cached.at < FRESH) return Promise.resolve(cached.data);
  if (!pending) {
    pending = api
      .get<StockData>('/api/stock')
      .then((data) => {
        cached = { at: Date.now(), data };
        subs.forEach((f) => f(data));
        return data;
      })
      .catch(() => cached?.data || EMPTY)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Ambil data stok sekali (mis. untuk cetak), memakai cache bila masih segar. */
export function loadStockData(): Promise<StockData> {
  return load();
}

export function refreshStock() {
  void load(true);
}

export function useStock(enabled = true): StockData {
  const [data, setData] = useState<StockData>(() => cached?.data || EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const on = (d: StockData) => alive && setData(d);
    subs.add(on);
    if (!socketBound) {
      socketBound = true;
      getSocket().on('stock:updated', () => refreshStock());
    }
    void load().then(on);
    return () => {
      alive = false;
      subs.delete(on);
    };
  }, [enabled]);
  return data;
}
