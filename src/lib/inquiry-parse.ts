/**
 * Baca teks inquiry yang ditempel Marketing (email Indotrading, form website,
 * email biasa, chat WA) menjadi isian Tambah Lead: perusahaan, kontak,
 * jabatan, telepon, email, alamat, sumber, baris kebutuhan material, dan
 * sisa pesan sebagai catatan. Heuristik saja — hasilnya tetap diperiksa di
 * form sebelum dikirim. Client-safe.
 */

export interface ParsedInquiry {
  customer: string;
  kontakNama: string;
  kontakJabatan: string;
  phone: string;
  email: string;
  alamat: string;
  source: string;
  /** Teks per kebutuhan material — dibaca lagi oleh pembaca material (bentuk, grade, ukuran, pcs). */
  items: string[];
  catatan: string;
}

const LABELS: { key: keyof ParsedInquiry | 'pesan' | 'produk' | 'skip'; re: RegExp }[] = [
  { key: 'customer', re: /^(nama\s+perusahaan|perusahaan|company(\s+name)?|instansi|badan\s+usaha)$/i },
  { key: 'kontakNama', re: /^(nama(\s+lengkap)?|name|full\s*name|contact(\s+person)?|kontak|pic|dari|from|pengirim|sender)$/i },
  { key: 'kontakJabatan', re: /^(jabatan|position|title|job\s*title|bagian|departemen|department)$/i },
  { key: 'phone', re: /^(no\.?\s*(telp|telepon|hp|wa|handphone)|telp|telepon|telephone|phone|mobile|hp|wa|whatsapp|no\.?\s*kontak)$/i },
  { key: 'email', re: /^(e-?mail|alamat\s+email)$/i },
  { key: 'alamat', re: /^(alamat|address|lokasi|location|kota|city|alamat\s+pengiriman)$/i },
  { key: 'produk', re: /^(produk|product|kebutuhan|item|barang|material|nama\s+produk|product\s+name|spesifikasi|spec)$/i },
  { key: 'pesan', re: /^(pesan|message|isi\s+pesan|keterangan|catatan|detail(\s+inquiry)?|inquiry|permintaan)$/i },
  { key: 'skip', re: /^(subject|subjek|tanggal|date|waktu|time|to|kepada|cc|jumlah|qty|quantity)$/i },
];

const COMPANY_RE = /\b(PT|CV|UD|PD|Tbk|Koperasi|Persero|Ltd|Inc|Corp)\b\.?/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?62|0)[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}/;
/** Kalimat / baris yang menyebut ukuran atau nama material. */
const ITEM_HINT = /(\d+(?:[.,]\d+)?\s*(?:mm)?\s*[x×*]\s*\d+)|\b(dia|ø|od|tebal|thk|t\s*\d)|\b(pelat|plat|plate|round\s*bar|as\b|hollow|pipa|pipe|siku|wf\b|unp|cnp|liner|creusabro|hardox|abrex|quard|raex|xar|ss\s*\d{3}|hq\s*\d{3}|s45c|scm|skd)/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const normPhone = (s: string) => clean(s).replace(/[^\d+]/g, '').replace(/^62/, '+62');

/**
 * Rapikan kalimat kebutuhan ke bentuk yang dikenali pembaca material:
 * "plat creusabro 4800 tebal 20mm ukuran 2000x6000 sebanyak 3 lembar"
 *   -> "Creusabro 4800 # 20 x 2000 x 6000 mm 3 lbr".
 */
export function normalizeItemText(raw: string): string {
  let s = ` ${raw} `.replace(/[×*]/g, 'x').replace(/\s+/g, ' ');
  // Jumlah: "sebanyak 3 lembar", "qty 4 lbr", "3 pcs", "2 batang".
  let qty = '';
  let unit = '';
  s = s.replace(/\b(?:sebanyak|qty|quantity|jumlah|jml)?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(lembar|lbr|sheet|sheets|pcs|pc|buah|bh|batang|btg|unit|set)\b\.?/i, (_m, n: string, u: string) => {
    qty = n.replace(',', '.');
    unit = /^(lembar|lbr|sheet)/i.test(u) ? 'lbr' : /^(batang|btg)/i.test(u) ? 'btg' : 'pcs';
    return ' ';
  });
  const plate = /\b(plat|pelat|plate|sheet|liner)\b/i.test(s) || /\b(tebal|thk|thickness)\b/i.test(s) || /\bt\s?\d+(?:[.,]\d+)?\s*x\s*\d/i.test(s) || /(?:^|\s)\d{1,3}(?:[.,]\d+)?\s*(?:mm)?\s*x\s*\d{3,5}\s*(?:mm)?\s*x\s*\d{3,5}/.test(s);
  if (plate) {
    // tebal 20 (mm) ukuran 2000 x 6000  |  t20 x 2000 x 6000  |  20 x 2000 x 6000
    const m =
      /\b(?:tebal|thk|thickness|t)\s*[:.]?\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*(?:x|,)?\s*(?:ukuran|size|uk\.?)?\s*[:.]?\s*(\d{3,5})\s*(?:mm)?\s*x\s*(\d{3,5})/i.exec(s) ||
      /(?:^|\s)(\d{1,3}(?:[.,]\d+)?)\s*(?:mm)?\s*x\s*(\d{3,5})\s*(?:mm)?\s*x\s*(\d{3,5})/i.exec(s);
    if (m) {
      const before = s.slice(0, m.index).replace(/\b(plat|pelat|plate|sheet)\b/gi, ' ').replace(/\b(ukuran|size|tebal|grade)\b/gi, ' ');
      const grade = before.replace(/\s+/g, ' ').trim();
      return `${grade} # ${m[1].replace(',', '.')} x ${m[2]} x ${m[3]} mm${qty ? ` ${qty} ${unit || 'lbr'}` : ''}`.trim();
    }
  }
  // Bukan pelat: biarkan apa adanya (pembaca material sudah mengenal "dia", "batang", dst.).
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseInquiry(text: string): ParsedInquiry {
  const out: ParsedInquiry = { customer: '', kontakNama: '', kontakJabatan: '', phone: '', email: '', alamat: '', source: '', items: [], catatan: '' };
  const src = String(text || '').replace(/\r/g, '');
  if (/indotrading/i.test(src)) out.source = 'indotrading';
  else if (/website|web\s*form|formulir\s+kontak|contact\s+form/i.test(src)) out.source = 'website';
  else if (/pameran|expo|exhibition|booth/i.test(src)) out.source = 'pameran';
  else if (/whats\s*app|\bwa\b/i.test(src)) out.source = 'telepon';

  const lines = src.split('\n').map((l) => l.replace(/^[\s>*•\-–]+|\s+$/g, '')).filter(Boolean);
  const pesan: string[] = [];
  const produk: string[] = [];
  let current: string | null = null;
  for (const raw of lines) {
    const m = /^([A-Za-z][A-Za-z .\-/]{1,30}?)\s*[:：]\s*(.*)$/.exec(raw);
    const label = m ? LABELS.find((l) => l.re.test(clean(m[1]))) : undefined;
    if (m && label) {
      const val = clean(m[2]);
      current = label.key;
      if (label.key === 'pesan') {
        if (val) pesan.push(val);
      } else if (label.key === 'produk') {
        if (val) produk.push(val);
      } else if (label.key !== 'skip' && val) {
        const k = label.key as keyof ParsedInquiry;
        if (k === 'items') continue;
        if (!(out[k] as string)) (out as unknown as Record<string, string>)[k] = val;
        else if (k === 'alamat') out.alamat = `${out.alamat}, ${val}`;
      }
      continue;
    }
    // Baris lanjutan tanpa label: ikut ke label terakhir (pesan / alamat / produk).
    if (current === 'pesan') pesan.push(raw);
    else if (current === 'alamat' && raw.length < 120 && !EMAIL_RE.test(raw)) out.alamat = `${out.alamat}${out.alamat ? ', ' : ''}${clean(raw)}`;
    else if (current === 'produk' && ITEM_HINT.test(raw)) produk.push(raw);
    else pesan.push(raw);
  }

  // Tanpa label: cari dari seluruh teks.
  if (!out.email) out.email = EMAIL_RE.exec(src)?.[0] || '';
  else out.email = EMAIL_RE.exec(out.email)?.[0] || out.email;
  const ph = PHONE_RE.exec(out.phone || '') || PHONE_RE.exec(src);
  out.phone = ph ? normPhone(ph[0]) : out.phone;
  if (!out.customer) out.customer = lines.map(clean).find((l) => COMPANY_RE.test(l) && l.length <= 80 && !/indotrading/i.test(l))?.replace(/^(dari|from|salam|hormat\s+kami)[,:]?\s*/i, '') || '';
  // Tanda tangan email: baris nama (± jabatan) sesudah "Regards / Salam / Hormat kami".
  const signIdx = lines.findIndex((l) => /^(best\s+)?(regards|salam|hormat\s+kami|terima\s*kasih|thanks|thank\s+you|wassalam)[,.!]*$/i.test(clean(l)));
  if (!out.kontakNama && signIdx >= 0) {
    const cand = lines.slice(signIdx + 1).map(clean).find((l) => l && !COMPANY_RE.test(l) && !EMAIL_RE.test(l) && !PHONE_RE.test(l) && l.length <= 60 && !/\d{3}/.test(l));
    if (cand) out.kontakNama = cand;
  }
  // "Budi - Purchasing PT X" / "Budi (Purchasing)"
  if (out.kontakNama && !out.kontakJabatan) {
    const j = /^(.*?)\s*(?:[-–,]\s*|\()([^()]+?)\)?$/.exec(out.kontakNama);
    if (j && j[1] && j[2] && !COMPANY_RE.test(j[2]) && j[2].length <= 40) {
      out.kontakNama = clean(j[1]);
      out.kontakJabatan = clean(j[2]);
    }
  }

  // Kebutuhan: isian Produk + kalimat pesan yang menyebut material / ukuran.
  const fromPesan: string[] = [];
  const rest: string[] = [];
  pesan.forEach((l) => {
    const parts = l.split(/(?<=[.;])\s+|\s*;\s*/).filter(Boolean);
    parts.forEach((s) => (ITEM_HINT.test(s) && /\d/.test(s) ? fromPesan.push(s) : rest.push(s)));
  });
  const SIZE = /\d\s*(mm)?\s*[x×*]\s*\d|\b(tebal|thk|dia|ø|od)\b|\bt\s*\d/i;
  const lead = /^((dear|yth\.?|kepada)[^,]*,\s*|selamat\s+(pagi|siang|sore|malam)[,.!]?\s*|halo[,.!]?\s*)+/i;
  const ask = /^(mohon|minta|tolong|butuh|request|kami\s+(butuh|perlu|ingin|membutuhkan)|penawaran(\s+harga)?(\s+untuk)?|dibutuhkan)\s+(penawaran(\s+harga)?(\s+untuk)?\s+)?/i;
  const tidy = (s: string) => clean(clean(s).replace(lead, '').replace(ask, '')).replace(/[.;,]+$/, '');
  // Isian Produk tanpa ukuran diabaikan bila pesan sudah menyebut ukurannya.
  const prodKeep = fromPesan.length ? produk.filter((s) => SIZE.test(s)) : produk;
  const items = [...prodKeep, ...fromPesan].map(tidy);
  out.items = items.filter((s, i) => s && items.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i).map(normalizeItemText);
  const known = [out.customer, out.kontakNama].filter(Boolean).map((s) => s.toLowerCase());
  const digits = out.phone.replace(/\D/g, '').slice(-8);
  out.catatan = clean(
    rest
      .map((s) => clean(s).replace(lead, ''))
      .filter((s) => s && !EMAIL_RE.test(s) && !/^(best\s+)?(salam|regards|terima\s*kasih|thanks|thank\s+you|wassalam|hormat\s+kami)/i.test(s) && !/indotrading/i.test(s))
      .filter((s) => !known.some((k) => s.toLowerCase().includes(k) || k.includes(s.toLowerCase())) && !(digits && s.replace(/\D/g, '').includes(digits)))
      .join(' '),
  ).slice(0, 500);
  out.customer = clean(out.customer).slice(0, 150);
  out.kontakNama = clean(out.kontakNama).slice(0, 120);
  out.alamat = clean(out.alamat).slice(0, 500);
  return out;
}
