/**
 * Kampanye Marketing: daftar sasaran customer (dari kriteria segmen, cabang,
 * grade yang pernah dibeli, status order) yang dikirimi email atau
 * ditindaklanjuti manual, lalu diukur hasilnya: prospek baru customer tsb.
 * dalam CAMPAIGN_WINDOW_DAYS hari setelah kampanye. Client-safe.
 */
export const CAMPAIGN_WINDOW_DAYS = 120;

/** Siapa yang boleh membuat / mengirim kampanye. */
export function canRunCampaign(role: string | null | undefined): boolean {
  return role === 'marketing' || role === 'gm' || role === 'vp' || role === 'admin';
}

export interface CampaignTarget {
  customerId: string;
  name: string;
  cabang: string;
  emails: string[];
}

export interface CampaignResultRow {
  name: string;
  cabang: string;
  prospek: number;
  penawaran: number;
  po: number;
  nilaiPo: number;
  /** Tahap terjauh: '' | 'prospek' | 'penawaran' | 'po'. */
  best: '' | 'prospek' | 'penawaran' | 'po';
}

export interface CampaignSummary {
  id: string;
  nama: string;
  channel: 'email' | 'manual';
  subject: string;
  sentAt: string | null;
  createdBy: string | null;
  targets: number;
  sentCount: number;
  failed: string[];
  filterText: string;
  result: { customers: number; prospek: number; penawaran: number; po: number; nilaiPo: number; rows: CampaignResultRow[] };
}
