'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconTrash, IconUpload } from './icons';
import { formatFileSize } from '@/lib/format';
import { useDataStore } from '@/store/useDataStore';
import type { Attachment } from '@/lib/types';

interface Props {
  rfqId?: string | null;
  fupaId?: string | null;
  readOnly?: boolean;
}

/**
 * Attachment panel shared by the RFQ and FUP A modals. Files upload straight to
 * object storage through /api/attachments; downloads go through a redirect to a
 * short-lived presigned URL, so the bucket never has to be public.
 */
export function AttachmentList({ rfqId, fupaId, readOnly }: Props) {
  const parentId = rfqId || fupaId || null;
  const query = rfqId ? `rfqId=${rfqId}` : `fupaId=${fupaId}`;

  const toast = useDataStore((s) => s.toast);
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!parentId) return;
    try {
      const res = await fetch(`/api/attachments?${query}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.attachments || []);
    } catch {
      // a failed list read is not worth a toast — the panel just stays empty
    }
  }, [parentId, query]);

  useEffect(() => {
    setItems([]);
    load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files || !parentId || readOnly) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append('file', file);
      if (rfqId) body.append('rfqId', rfqId);
      if (fupaId) body.append('fupaId', fupaId);
      try {
        // Deliberately raw fetch: api-client forces a JSON content-type, which
        // would break the multipart boundary.
        const res = await fetch('/api/attachments', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Gagal mengunggah file.');
        setItems((prev) => [...prev, data.attachment]);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Gagal mengunggah file.', 'error');
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = async (id: string) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Gagal menghapus lampiran.');
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus lampiran.', 'error');
    }
  };

  if (!parentId) {
    return <div className="import-summary">Simpan dokumen terlebih dahulu untuk menambahkan lampiran.</div>;
  }

  return (
    <div>
      {!readOnly && (
        <div
          className={`attach-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          <IconUpload />
          <span>{busy ? 'Mengunggah…' : 'Tarik file ke sini atau klik untuk memilih'}</span>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="import-summary" style={{ marginTop: 10 }}>Belum ada lampiran.</div>
      ) : (
        <table className="simple-table" style={{ marginTop: 10 }}>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a>
                </td>
                <td style={{ width: 90, whiteSpace: 'nowrap' }}>{formatFileSize(a.size)}</td>
                <td style={{ width: 140 }}>{a.uploadedBy || '-'}</td>
                {!readOnly && (
                  <td style={{ width: 40 }}>
                    <button type="button" className="icon-btn danger" title="Hapus lampiran" onClick={() => remove(a.id)}>
                      <IconTrash />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
