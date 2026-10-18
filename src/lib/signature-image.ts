/**
 * Olah gambar tanda tangan di browser sebelum diunggah: latar terang dibuat
 * transparan (untuk foto / scan kertas), tinta digelapkan, dipangkas ke area
 * tinta, lalu diperkecil. Hasil: PNG transparan kecil (data URL).
 */

const MAX_W = 600;
const MAX_H = 220;
const INK = { r: 20, g: 32, b: 74 }; // biru tua seperti tinta pulpen

/** Lebar/tinggi kotak tinta (alpha > 0) dalam ImageData; null bila kosong. */
function inkBounds(img: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Pangkas ke area tinta & perkecil; null bila tidak ada coretan. */
function trimAndScale(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext('2d');
  if (!ctx) return null;
  const b = inkBounds(ctx.getImageData(0, 0, src.width, src.height));
  if (!b || b.w < 12 || b.h < 6) return null;
  const k = Math.min(1, MAX_W / b.w, MAX_H / b.h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(b.w * k));
  out.height = Math.max(1, Math.round(b.h * k));
  const o = out.getContext('2d');
  if (!o) return null;
  o.imageSmoothingQuality = 'high';
  o.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Dari kanvas gambar tangan (latar transparan). */
export function signatureFromCanvas(canvas: HTMLCanvasElement): string | null {
  return trimAndScale(canvas);
}

/**
 * Dari foto / scan: piksel terang -> transparan, piksel gelap -> tinta.
 * Ambang dihitung dari kecerahan kertas (persentil terang), jadi foto yang
 * agak gelap / kekuningan tetap bersih.
 */
export async function signatureFromFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / bmp.width, 1600 / bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const lum = new Uint8Array(c.width * c.height);
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) {
    const a = d[i * 4 + 3] / 255;
    // piksel transparan dianggap kertas putih
    const l = Math.round((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a));
    lum[i] = l;
    hist[l]++;
  }
  // kecerahan kertas ≈ persentil 90
  let acc = 0;
  let paper = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= lum.length * 0.1) {
      paper = v;
      break;
    }
  }
  const hi = paper - 18; // di atas ini = kertas (transparan)
  const lo = Math.max(0, paper - 110); // di bawah ini = tinta penuh
  for (let i = 0; i < lum.length; i++) {
    const l = lum[i];
    const alpha = l >= hi ? 0 : l <= lo ? 255 : Math.round(((hi - l) / (hi - lo)) * 255);
    d[i * 4] = INK.r;
    d[i * 4 + 1] = INK.g;
    d[i * 4 + 2] = INK.b;
    d[i * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return trimAndScale(c);
}
