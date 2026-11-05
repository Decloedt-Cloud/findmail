-- Derived size bands on company_leads (0 MICRO / 1 MID / 2 MACRO / 3 MEGA).
-- Nullable on purpose: rows with an unparseable size stay out of band filters
-- instead of being treated as MICRO. Backfill with
--   npx tsx scripts/backfill-company-lead-bands.ts

ALTER TABLE "company_leads" ADD COLUMN "employeeBand" INTEGER;
ALTER TABLE "company_leads" ADD COLUMN "revenueBand" INTEGER;
