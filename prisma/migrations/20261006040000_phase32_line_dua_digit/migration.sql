-- Phase 32: kode Line produk dua digit ("4" -> "04"). Aplikasi sekarang
-- menormalkan setiap input baru; migrasi ini merapikan data lama supaya
-- laporan per Line tidak memisahkan "4" dan "04". Hanya angka satu digit
-- yang diubah; isian lain (mis. "12", "PL-4") dibiarkan.

-- Kolom ringkasan Prospect.line, bisa berupa daftar "4, 7".
UPDATE "Prospect" SET "line" = (
  SELECT string_agg(CASE WHEN t ~ '^[0-9]$' THEN '0' || t ELSE t END, ', ' ORDER BY ord)
  FROM unnest(string_to_array(regexp_replace(btrim("line"), '\s*,\s*', ',', 'g'), ',')) WITH ORDINALITY AS u(t, ord)
  WHERE t <> ''
)
WHERE "line" ~ '(^|,)\s*[0-9]\s*(,|$)';

-- Field "line" di dalam daftar JSON (material prospek, item RFQ/FUP A/rencana).
UPDATE "Prospect" p SET "materials" = (
  SELECT jsonb_agg(CASE WHEN (e->>'line') ~ '^\s*[0-9]\s*$' THEN jsonb_set(e, '{line}', to_jsonb('0' || btrim(e->>'line'))) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(p."materials") WITH ORDINALITY AS x(e, ord)
)
WHERE jsonb_typeof(p."materials") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p."materials") e WHERE (e->>'line') ~ '^\s*[0-9]\s*$');

UPDATE "Rfq" r SET "items" = (
  SELECT jsonb_agg(CASE WHEN (e->>'line') ~ '^\s*[0-9]\s*$' THEN jsonb_set(e, '{line}', to_jsonb('0' || btrim(e->>'line'))) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(r."items") WITH ORDINALITY AS x(e, ord)
)
WHERE jsonb_typeof(r."items") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(r."items") e WHERE (e->>'line') ~ '^\s*[0-9]\s*$');

UPDATE "Fupa" f SET "items" = (
  SELECT jsonb_agg(CASE WHEN (e->>'line') ~ '^\s*[0-9]\s*$' THEN jsonb_set(e, '{line}', to_jsonb('0' || btrim(e->>'line'))) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(f."items") WITH ORDINALITY AS x(e, ord)
)
WHERE jsonb_typeof(f."items") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(f."items") e WHERE (e->>'line') ~ '^\s*[0-9]\s*$');

UPDATE "SalesPlan" s SET "items" = (
  SELECT jsonb_agg(CASE WHEN (e->>'line') ~ '^\s*[0-9]\s*$' THEN jsonb_set(e, '{line}', to_jsonb('0' || btrim(e->>'line'))) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(s."items") WITH ORDINALITY AS x(e, ord)
)
WHERE jsonb_typeof(s."items") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."items") e WHERE (e->>'line') ~ '^\s*[0-9]\s*$');
