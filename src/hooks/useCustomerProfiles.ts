'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { localToday } from '@/lib/customer-contact';
import { buildProfileIndex, type CustomerFacts, type SegmentBenchmark } from '@/lib/customer-profile';
import type { SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';

/**
 * Fakta profil semua customer dalam cakupan user. Aktivitas Harian dimuat
 * ulang setiap kali `active` menjadi true (modal dibuka), seperti Customer
 * Intelligence, supaya kontak yang baru dicatat langsung terhitung.
 */
export function useCustomerProfiles(active: boolean, withBench = false) {
  const prospects = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const groups = useDataStore((s) => s.customerGroups);
  const issues = useDataStore((s) => s.issues);
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [benchmarks, setBenchmarks] = useState<SegmentBenchmark[]>([]);

  const load = useCallback(async () => {
    // Rata-rata segmen nasional (agregat tanpa nama) — gagal tidak mengganggu profil.
    if (withBench) api.get<{ benchmarks: SegmentBenchmark[] }>('/api/customer-benchmarks').then((r) => setBenchmarks(r.benchmarks)).catch(() => setBenchmarks([]));
    try {
      setActivities((await api.get<{ activities: SalesActivity[] }>('/api/sales-activities?all=1')).activities);
    } catch {
      setActivities([]);
    } finally {
      setLoaded(true);
    }
  }, [withBench]);
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const today = localToday();
  const index = useMemo<Map<string, CustomerFacts>>(
    () => buildProfileIndex({ prospects, activities, customers, groups, issues, today }),
    [prospects, activities, customers, groups, issues, today],
  );
  return { index, loaded, activities, today, benchmarks, reload: load };
}
