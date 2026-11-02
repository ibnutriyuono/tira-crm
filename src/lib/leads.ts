/**
 * Lead dari Product & Marketing: permintaan yang masuk lewat Indotrading,
 * website, pameran, telepon/email ke kantor pusat, dsb. Disimpan sebagai
 * prospek berstatus 1 (Permintaan) di cabang tujuan dengan penanda lead
 * (leadSource/leadBy/leadAt). BM cabang diberi tahu dan menunjuk Sales bila
 * Marketing belum memilih SE; Marketing diberi tahu tiap perkembangannya.
 * Client-safe (dipakai server & browser).
 */
import type { Prospect } from './types';

export const LEAD_SOURCES: { key: string; label: string }[] = [
  { key: 'indotrading', label: 'Indotrading' },
  { key: 'website', label: 'Website / email' },
  { key: 'telepon', label: 'Telepon / WA ke kantor' },
  { key: 'pameran', label: 'Pameran / event' },
  { key: 'referensi', label: 'Referensi / rekomendasi' },
  { key: 'kampanye', label: 'Kampanye reaktivasi' },
  { key: 'lainnya', label: 'Lainnya' },
];
export const LEAD_SOURCE_LABEL: Record<string, string> = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s.label]));
export const leadSourceLabel = (k: string | null | undefined) => (k ? LEAD_SOURCE_LABEL[k] || k : '');

/** Lead belum ditindaklanjuti setelah sekian hari (masih Permintaan / belum ada SE) — ditandai di Beranda Marketing. */
export const LEAD_STALE_DAYS = 3;

export function isLead(p: Pick<Prospect, 'leadAt' | 'leadSource'>): boolean {
  return !!(p.leadAt || p.leadSource);
}

export type LeadStage = 'baru' | 'ditugaskan' | 'penawaran' | 'menang' | 'kalah';

/** Tahap lead dari sudut Marketing: baru (belum ada SE) → ditugaskan → penawaran/negosiasi → menang / kalah. */
export function leadStage(p: Pick<Prospect, 'status' | 'se'>): LeadStage {
  const st = Number(p.status);
  if (st === 6) return 'kalah';
  if (st >= 4) return 'menang';
  if (st >= 2) return 'penawaran';
  return (p.se || '').trim() ? 'ditugaskan' : 'baru';
}

export const LEAD_STAGE_META: Record<LeadStage, { label: string; badge: string }> = {
  baru: { label: 'Menunggu BM', badge: 'amber' },
  ditugaskan: { label: 'Ditugaskan ke Sales', badge: 'steel' },
  penawaran: { label: 'Penawaran / negosiasi', badge: 'violet' },
  menang: { label: 'PO / DO', badge: 'green' },
  kalah: { label: 'Lose', badge: 'rust' },
};
