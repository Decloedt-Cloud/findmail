-- Substring fallback on SIC names. Prefix filters use the existing btree indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "company_leads_sicName_trgm_idx"
  ON "company_leads" USING gin ("sicName" gin_trgm_ops);
