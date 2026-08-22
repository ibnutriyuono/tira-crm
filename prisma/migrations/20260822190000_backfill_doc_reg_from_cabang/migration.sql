-- Rows created without a source prospect were left with a NULL reg, which hid
-- them from their own RM once docScopeWhere started filtering on that column.
-- Derive the region from the branch, using the most common region seen for
-- that branch in the prospect table (the single-file app's cabangRegMap took
-- whichever it saw first, which is ambiguous when a branch spans regions).
WITH cabang_reg AS (
  SELECT UPPER(cabang) AS cabang, reg
  FROM (
    SELECT cabang, reg, ROW_NUMBER() OVER (PARTITION BY UPPER(cabang) ORDER BY COUNT(*) DESC, reg ASC) AS rn
    FROM "Prospect"
    WHERE cabang IS NOT NULL AND reg IS NOT NULL
    GROUP BY cabang, reg
  ) ranked
  WHERE rn = 1
)
UPDATE "Rfq" r
SET "reg" = cr.reg
FROM cabang_reg cr
WHERE r."reg" IS NULL AND UPPER(r."cabang") = cr.cabang;

WITH cabang_reg AS (
  SELECT UPPER(cabang) AS cabang, reg
  FROM (
    SELECT cabang, reg, ROW_NUMBER() OVER (PARTITION BY UPPER(cabang) ORDER BY COUNT(*) DESC, reg ASC) AS rn
    FROM "Prospect"
    WHERE cabang IS NOT NULL AND reg IS NOT NULL
    GROUP BY cabang, reg
  ) ranked
  WHERE rn = 1
)
UPDATE "Fupa" f
SET "reg" = cr.reg
FROM cabang_reg cr
WHERE f."reg" IS NULL AND UPPER(f."cabang") = cr.cabang;
