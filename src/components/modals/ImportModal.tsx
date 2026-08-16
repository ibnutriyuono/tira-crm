'use client';

import { useRef, useState } from 'react';
import type { WorkBook } from 'xlsx';
import { Modal } from '../Modal';
import { IconUpload } from '../icons';
import { formatRupiah, num } from '@/lib/format';
import { parseSheetToCustomerRecords, parseSheetToRecords, type ParseResult } from '@/lib/excel-import';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function ImportModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'import';
  const target = useUiStore((s) => s.importTarget);
  const closeModal = useUiStore((s) => s.closeModal);

  const refetchProspects = useDataStore((s) => s.refetchProspects);
  const refetchCustomers = useDataStore((s) => s.refetchCustomers);
  const toast = useDataStore((s) => s.toast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [parsed, setParsed] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName('');
    setWorkbook(null);
    setSheetNames([]);
    setSheetName('');
    setParsed([]);
    setParseError('');
    setMode('append');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function parseFor(aoa: unknown[][]): ParseResult {
    return target === 'customer' ? parseSheetToCustomerRecords(aoa) : parseSheetToRecords(aoa);
  }

  function applyPreview(wb: WorkBook, sheet: string, XLSXmod: typeof import('xlsx')) {
    const ws = wb.Sheets[sheet];
    const aoa = XLSXmod.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    const res = parseFor(aoa);
    if (res.error) {
      setParseError(res.error);
      setParsed([]);
    } else {
      setParseError('');
      setParsed(res.records || []);
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    try {
      const XLSXmod = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSXmod.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      setWorkbook(wb);
      setFileName(file.name);
      setSheetNames(wb.SheetNames);

      let best = wb.SheetNames[0];
      let bestScore = -1;
      wb.SheetNames.forEach((n) => {
        const ws = wb.Sheets[n];
        const aoa = XLSXmod.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
        const res = parseFor(aoa);
        const score = (res.records ? res.records.length : 0) + (target === 'prospect' && /CLOSING/i.test(n) ? 100000 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      });
      setSheetName(best);
      applyPreview(wb, best, XLSXmod);
    } catch {
      toast('Gagal membaca file. Pastikan formatnya .xlsx yang valid.', 'error');
    }
  }

  async function onSheetChange(sheet: string) {
    setSheetName(sheet);
    if (!workbook) return;
    const XLSXmod = await import('xlsx');
    applyPreview(workbook, sheet, XLSXmod);
  }

  async function onConfirm() {
    if (parsed.length === 0) return toast('Tidak ada data untuk diimport', 'error');
    setBusy(true);
    try {
      if (target === 'customer') {
        const { count } = await api.post<{ count: number }>('/api/customers/import', { records: parsed, mode });
        await refetchCustomers();
        toast(`Import berhasil: ${count} data customer ${mode === 'replace' ? 'menggantikan' : 'ditambahkan ke'} database`, 'success');
      } else {
        const { count } = await api.post<{ count: number }>('/api/prospects/import', { records: parsed, mode });
        await refetchProspects();
        toast(`Import berhasil: ${count} data prospek ${mode === 'replace' ? 'menggantikan' : 'ditambahkan ke'} CRM`, 'success');
      }
      closeModal();
      reset();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengimport data', 'error');
    } finally {
      setBusy(false);
    }
  }

  const title = target === 'customer' ? 'Import Data Customer dari Excel' : 'Import Data Prospek dari Excel';
  const hint = target === 'customer' ? 'Header sheet harus memiliki kolom NAMA CUSTOMER (atau CUSTOMER / NAMA)' : 'Mendukung file dengan format seperti PROSPECT LIST (header berisi kolom CUSTOMER)';

  return (
    <Modal
      show={show}
      onClose={() => {
        closeModal();
        reset();
      }}
      title={title}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              closeModal();
              reset();
            }}
          >
            Batal
          </button>
          <button type="button" className="btn btn-primary" disabled={parsed.length === 0 || busy} onClick={onConfirm}>
            Import Data
          </button>
        </>
      }
    >
      <div
        className={`drop-zone${dragging ? ' drag' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
        }}
      >
        <IconUpload />
        <div>Klik atau tarik file .xlsx ke sini</div>
        <div style={{ fontSize: 11.5, marginTop: 4 }}>{hint}</div>
        <div className="file-name">{fileName}</div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
      />
      {workbook && (
        <div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="full">
              <label>Pilih Sheet</label>
              <select value={sheetName} onChange={(e) => onSheetChange(e.target.value)}>
                {sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="import-summary">
            {parseError ? (
              <>
                <b style={{ color: 'var(--rust-500)' }}>Gagal membaca sheet:</b> {parseError}
              </>
            ) : target === 'customer' ? (
              <>
                Ditemukan <b>{parsed.length}</b> baris data customer pada sheet &quot;<b>{sheetName}</b>&quot;.
              </>
            ) : (
              <>
                Ditemukan <b>{parsed.length}</b> baris data prospek pada sheet &quot;<b>{sheetName}</b>&quot;. Total estimasi nilai: <b>{formatRupiah(parsed.reduce((s, r) => s + num((r as { value?: unknown }).value), 0))}</b>.
              </>
            )}
          </div>
          <div className="radio-row">
            <label>
              <input type="radio" name="importMode" checked={mode === 'append'} onChange={() => setMode('append')} /> Tambahkan ke data yang ada
            </label>
            <label>
              <input type="radio" name="importMode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Ganti seluruh data
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}
