'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from './icons';
import { RFQ_LOKAL_OPTIONS } from '@/lib/constants';
import { formatRupiah, normalizeLine, num } from '@/lib/format';
import {
  GRADE_SUGGESTIONS,
  SATUAN_FAB,
  SHAPES,
  SHAPE_NAMES,
  autoUraian,
  autoWeight,
  emptyRow,
  isFabRow,
  parseMaterialText,
  roundUpKg,
  rowBeratPc,
  rowTotal,
  type DimKey,
  type SpecRow,
} from '@/lib/material-spec';

interface Props {
  /** 'prospek' shows Harga/kg + Total; 'doc' (RFQ / FUP A) shows Lokal/Import + tanggal butuh. */
  variant: 'prospek' | 'doc';
  rows: SpecRow[];
  onChange: (rows: SpecRow[]) => void;
  /** Rendered under a row (e.g. Purchasing's answer on an RFQ item). */
  renderRowExtra?: (row: SpecRow, idx: number) => React.ReactNode;
  /** The form already shows its own totals. */
  hideSummary?: boolean;
}

const kg = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/**
 * Daftar Material — the same editor on Edit Prospek, RFQ and FUP A.
 * Bentuk decides which dimension boxes show; berat/pc (rounded up) and the
 * uraian are filled in from them, and either can still be typed over.
 */
export function MaterialSpecEditor({ variant, rows, onChange, renderRowExtra, hideSummary }: Props) {
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const prospek = variant === 'prospek';

  const update = (idx: number, patch: Partial<SpecRow>) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const setDim = (idx: number, k: DimKey, v: string) => update(idx, { dim: { ...rows[idx].dim, [k]: v } });
  const remove = (idx: number) => onChange(rows.length <= 1 ? [emptyRow()] : rows.filter((_, i) => i !== idx));

  function applyPaste() {
    const lines = paste.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const added = lines.map((s) => {
      const p = parseMaterialText(s);
      return emptyRow({ bentuk: p.bentuk, grade: p.grade, dim: p.dim, pcs: p.pcs || '1', uraianManual: p.bentuk === 'Lainnya' && !p.grade ? s : '' });
    });
    // Replace the single blank starter row instead of leaving it on top.
    const keep = rows.filter((r) => r.line || r.grade || r.uraianManual || r.fabNama || Object.values(r.dim).some(Boolean));
    onChange([...keep, ...added]);
    setPaste('');
    setShowPaste(false);
  }

  const totalPcs = rows.reduce((s, r) => s + num(r.pcs), 0);
  const totalBerat = rows.reduce((s, r) => s + num(r.pcs) * rowBeratPc(r), 0);
  const totalValue = rows.reduce((s, r) => s + rowTotal(r), 0);

  return (
    <div className="msr">
      <div className="msr-paste-toggle">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowPaste((v) => !v)}>
          {showPaste ? 'Tutup' : 'Tempel dari teks'}
        </button>
        <span className="field-note" style={{ margin: 0 }}>
          Ketik / tempel uraian lama, cth. <i>AS HQ 705 Dia 75 x 6 M</i> — bentuk, grade, ukuran dan pcs terisi otomatis.
        </span>
      </div>
      {showPaste && (
        <div className="msr-paste">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder={'Satu material per baris, cth.\nAS HQ 705 Dia 75 x 6 M\nTW 400 # 20 X 1500 X 3000 mm 2 lbr\nWF 200 x 100 x 5,5 x 8 x 12 M'}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={applyPaste}>
            Isi otomatis
          </button>
        </div>
      )}

      <datalist id="msr-grades">
        {GRADE_SUGGESTIONS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {rows.map((r, idx) => {
        const fab = isFabRow(r);
        const dims = SHAPES[r.bentuk] || [];
        const auto = roundUpKg(autoWeight(r.bentuk, r.dim));
        const autoText = autoUraian(r.bentuk, r.grade, r.dim);
        const manualText = r.uraianManual.trim() !== '';
        return (
          <div className={`msr-row${fab ? ' msr-fab' : ''}`} key={r.key}>
            <div className="msr-top">
              <div className="msr-f msr-line">
                <label>Line</label>
                <input type="text" value={r.line} placeholder="02" onChange={(e) => update(idx, { line: e.target.value })} onBlur={(e) => update(idx, { line: normalizeLine(e.target.value) })} />
              </div>
              {fab ? (
                <>
                  <div className="msr-f msr-grow">
                    <label>Nama pekerjaan / item fabrikasi</label>
                    <input type="text" value={r.fabNama} placeholder="cth. Bracket conveyor (sesuai gambar)" onChange={(e) => update(idx, { fabNama: e.target.value })} />
                  </div>
                  <div className="msr-f" style={{ width: 170 }}>
                    <label>No. gambar / Rev</label>
                    <input type="text" value={r.noGambar} placeholder="DWG-01 Rev.0" onChange={(e) => update(idx, { noGambar: e.target.value })} />
                  </div>
                </>
              ) : (
                <>
                  <div className="msr-f" style={{ width: 132 }}>
                    <label>Bentuk</label>
                    <select value={r.bentuk} onChange={(e) => update(idx, { bentuk: e.target.value })}>
                      {SHAPE_NAMES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="msr-f" style={{ width: 118 }}>
                    <label>Grade</label>
                    <input type="text" list="msr-grades" value={r.grade} placeholder="HQ 705" onChange={(e) => update(idx, { grade: e.target.value })} />
                  </div>
                  <div className="msr-f msr-grow">
                    <label>Ukuran (mm)</label>
                    {dims.length === 0 ? (
                      <div className="field-note" style={{ margin: '9px 0 0' }}>Isi uraian di bawah</div>
                    ) : (
                      <div className="msr-dims">
                        {dims.map(([k, label], j) => (
                          <span key={k} className="msr-dim">
                            {j > 0 && <span aria-hidden="true">×</span>}
                            <input type="text" inputMode="decimal" aria-label={label} placeholder={label} value={r.dim[k] || ''} onChange={(e) => setDim(idx, k, e.target.value)} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <button type="button" className="icon-btn danger msr-del" onClick={() => remove(idx)} title="Hapus material">
                <IconTrash />
              </button>
            </div>

            <div className="msr-bottom">
              {fab ? (
                <div className="msr-f msr-grow">
                  <label>Uraian</label>
                  <div className="msr-uraian-fab">LINE 05 · FABRIKASI — dijual per {r.satuan}; lampirkan gambar kerja di bagian Lampiran.</div>
                </div>
              ) : (
                <div className="msr-f msr-grow">
                  <label>
                    Uraian <span className={`msr-tag${manualText ? ' manual' : ''}`}>{manualText ? 'diubah manual' : 'otomatis'}</span>
                  </label>
                  <input
                    type="text"
                    value={manualText ? r.uraianManual : autoText}
                    onChange={(e) => update(idx, { uraianManual: e.target.value === autoText ? '' : e.target.value })}
                    placeholder="Uraian material"
                  />
                </div>
              )}
              <div className="msr-f" style={{ width: 70 }}>
                <label>{fab ? 'Qty' : 'Pcs'}</label>
                <input type="number" min={0} step="any" value={r.pcs} onChange={(e) => update(idx, { pcs: e.target.value })} />
              </div>
              {fab ? (
                <div className="msr-f" style={{ width: 92 }}>
                  <label>Satuan</label>
                  <select value={r.satuan} onChange={(e) => update(idx, { satuan: e.target.value })}>
                    {SATUAN_FAB.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="msr-f" style={{ width: 96 }}>
                  <label title="Otomatis dari ukuran, dibulatkan ke atas. Ketik untuk menimpa, kosongkan untuk kembali otomatis.">Berat/pc (kg)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={r.beratManual.trim() === '' ? 'msr-auto' : ''}
                    value={r.beratManual.trim() !== '' ? r.beratManual : auto ? String(auto) : ''}
                    placeholder="kg"
                    onChange={(e) => update(idx, { beratManual: e.target.value === String(auto) ? '' : e.target.value })}
                  />
                </div>
              )}
              {prospek ? (
                <>
                  <div className="msr-f" style={{ width: 118 }}>
                    <label>{fab ? `Harga / ${r.satuan}` : 'Harga/kg'}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={fab ? r.hargaUnit : r.hargaKg}
                      placeholder="Rp"
                      onChange={(e) => update(idx, fab ? { hargaUnit: e.target.value } : { hargaKg: e.target.value })}
                    />
                  </div>
                  <div className="msr-f msr-total" style={{ width: 128 }}>
                    <label>Total</label>
                    <div className="mono">{formatRupiah(rowTotal(r))}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="msr-f" style={{ width: 128 }}>
                    <label>Lokal/Import</label>
                    <select value={r.lokal} onChange={(e) => update(idx, { lokal: e.target.value })}>
                      {RFQ_LOKAL_OPTIONS.map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="msr-f" style={{ width: 146 }}>
                    <label>{fab ? 'Target selesai' : 'Estimasi kebutuhan'}</label>
                    <input type="date" value={r.estimasi} onChange={(e) => update(idx, { estimasi: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            {renderRowExtra?.(r, idx)}
          </div>
        );
      })}

      <div className="msr-foot">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange([...rows, emptyRow()])}>
          <IconPlus /> Tambah Material
        </button>
        {!hideSummary && <div className="msr-sum">
          <span>
            Total Pcs <b className="mono">{kg(totalPcs)}</b>
          </span>
          <span>
            Total Berat <b className="mono">{kg(totalBerat)} kg</b>
          </span>
          {prospek && (
            <span>
              Total Value <b className="mono">{formatRupiah(totalValue)}</b>
            </span>
          )}
        </div>}
      </div>
    </div>
  );
}
