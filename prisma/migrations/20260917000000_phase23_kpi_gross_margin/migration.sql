-- Gross Margin target + result for the KPI Scorecard, stored per month on
-- BudgetTarget alongside the existing revenue target. Both stay manual
-- (nullable) until the Sage 300 integration lands — the other three KPI
-- items are computed from Prospect/RFQ data and need no new columns.

-- AlterTable
ALTER TABLE "BudgetTarget" ADD COLUMN "grossMarginTarget" DOUBLE PRECISION,
                           ADD COLUMN "grossMarginResult" DOUBLE PRECISION;
