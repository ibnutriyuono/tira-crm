-- Margin di jawaban RFQ / FUP A berubah dari markup (harga = HPP × (1 + m))
-- menjadi gross margin atas harga jual (harga = HPP ÷ (1 − m)).
-- Isian margin yang sudah tersimpan dikonversi supaya harga jual yang sudah
-- dikirim ke Sales TIDAK berubah: m_baru = 100·m / (100 + m)  (mis. 35 → 25,93).
UPDATE "Rfq" SET items = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(e->'margin') = 'number' AND (e->>'margin')::numeric > -100
      THEN jsonb_set(e, '{margin}', to_jsonb(round(100 * (e->>'margin')::numeric / (100 + (e->>'margin')::numeric), 2)))
      ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements(items) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND items::text LIKE '%"margin"%';

UPDATE "Fupa" SET items = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(e->'margin') = 'number' AND (e->>'margin')::numeric > -100
      THEN jsonb_set(e, '{margin}', to_jsonb(round(100 * (e->>'margin')::numeric / (100 + (e->>'margin')::numeric), 2)))
      ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements(items) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND items::text LIKE '%"margin"%';
