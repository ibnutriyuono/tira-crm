'use client';

import type { SppDoc } from './spp-doc';

async function saveBlob(res: Response, fallback: string) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Gagal membuat Form SPP');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallback;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Unduh Form SPP dari isi tersimpan / otomatis (tanpa membuka form). */
export async function downloadSpp(fupaId: string, format: 'xlsx' | 'docx' = 'xlsx'): Promise<void> {
  await saveBlob(await fetch(`/api/fupas/${fupaId}/spp?format=${format}`, { credentials: 'same-origin' }), `SPP_FUP_A.${format}`);
}

/** Unduh Form SPP dari isi yang sedang diedit (ikut disimpan). */
export async function downloadSppDoc(fupaId: string, doc: SppDoc, format: 'xlsx' | 'docx'): Promise<void> {
  const res = await fetch(`/api/fupas/${fupaId}/spp`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, format }) });
  await saveBlob(res, `SPP_FUP_A.${format}`);
}
