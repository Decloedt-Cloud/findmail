-- LIKE '73%' does not use a plain btree index unless the column uses text_pattern_ops.
CREATE INDEX IF NOT EXISTS "company_leads_sicCode_pattern_idx" ON "company_leads" ("sicCode" text_pattern_ops);
CREATE INDEX IF NOT EXISTS "company_leads_naicsCode_pattern_idx" ON "company_leads" ("naicsCode" text_pattern_ops);
