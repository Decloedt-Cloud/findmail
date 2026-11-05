/**
 * Import USA B2B CSV dumps into company_leads (Findmail).
 *
 * Default: import every valid row (no sample cap). Streams + flushes in batches.
 *
 *   npx tsx scripts/import-company-leads-csv.ts
 *   npx tsx scripts/import-company-leads-csv.ts --dir=/path/to/csvs
 *   npx tsx scripts/import-company-leads-csv.ts --dry-run
 *   npx tsx scripts/import-company-leads-csv.ts --no-clear
 *   npx tsx scripts/import-company-leads-csv.ts --sample --max=50000
 */

import "../lib/load-env";
import { createReadStream } from "node:fs";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import type { NormalizedCompanyLead } from "../lib/company-leads/normalize";
import { normalizeCompanyLeadRow } from "../lib/company-leads/normalize";
import { parseCsvLine, zipCsvRow } from "../lib/company-leads/parse-csv";
import {
  DEFAULT_COMPANY_LEAD_SAMPLE,
  CompanyLeadSampleBudget,
} from "../lib/company-leads/sample";

const FLUSH_BATCH = 500;

type LeadRow = NormalizedCompanyLead & {
  sourceFile: string;
  importBatchId: string;
};

function appRoot(): string {
  const standalone = `${path.sep}.next${path.sep}standalone`;
  const cwd = path.resolve(process.cwd());
  const at = cwd.lastIndexOf(standalone);
  return at !== -1 ? cwd.slice(0, at) : cwd;
}

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function positiveInt(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return Math.floor(n);
}

async function listCsvFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .map((name) => path.join(dir, name))
    .sort();
}

async function flushBatch(
  prisma: { companyLead: { createMany: (args: { data: LeadRow[]; skipDuplicates: boolean }) => Promise<{ count: number }> } },
  batch: LeadRow[],
  dryRun: boolean,
): Promise<number> {
  if (batch.length === 0) return 0;
  if (dryRun) {
    const n = batch.length;
    batch.length = 0;
    return n;
  }
  const result = await prisma.companyLead.createMany({
    data: batch,
    skipDuplicates: true,
  });
  batch.length = 0;
  return result.count;
}

/** Full import: every valid email, no SIC/state/max caps. Streams into DB. */
async function importAll(opts: {
  files: string[];
  dryRun: boolean;
  clear: boolean;
}) {
  const { prisma } = await import("../lib/db");
  if (!opts.dryRun && opts.clear) {
    const deleted = await prisma.companyLead.deleteMany({});
    console.log(`Cleared existing leads: ${deleted.count}`);
  }

  const batchId = `full-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const seenEmails = new Set<string>();
  const pending: LeadRow[] = [];
  const counters = { read: 0, kept: 0, skipped: 0, duplicates: 0, inserted: 0 };

  console.log(`Mode: full (no cap)${opts.dryRun ? " (dry-run)" : ""}`);
  console.log(`Batch: ${batchId}`);

  for (const file of opts.files) {
    console.log(`→ ${path.basename(file)}`);
    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let headers: string[] | null = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!headers) {
        headers = parseCsvLine(line).map((h) => h.trim());
        continue;
      }
      counters.read += 1;
      const lead = normalizeCompanyLeadRow(zipCsvRow(headers, parseCsvLine(line)));
      if (!lead) {
        counters.skipped += 1;
        continue;
      }
      if (seenEmails.has(lead.emailNormalized)) {
        counters.duplicates += 1;
        continue;
      }
      seenEmails.add(lead.emailNormalized);
      counters.kept += 1;
      pending.push({
        ...lead,
        sourceFile: path.basename(file),
        importBatchId: batchId,
      });
      if (pending.length >= FLUSH_BATCH) {
        counters.inserted += await flushBatch(prisma, pending, opts.dryRun);
      }
      if (counters.read % 100_000 === 0) {
        console.log(
          `  … read=${counters.read} kept=${counters.kept} dup=${counters.duplicates} inserted=${counters.inserted}`,
        );
      }
    }
  }

  counters.inserted += await flushBatch(prisma, pending, opts.dryRun);

  console.log("Done", {
    batchId,
    ...counters,
    uniqueEmails: seenEmails.size,
    ...(opts.dryRun
      ? {}
      : { tableCount: await prisma.companyLead.count() }),
  });
  await prisma.$disconnect();
}

/** Optional: stratified sample (old behaviour). */
async function importSample(opts: {
  files: string[];
  dryRun: boolean;
  clear: boolean;
  max: number;
  maxPerSic: number;
  maxPerState: number;
}) {
  const budget = new CompanyLeadSampleBudget({
    max: opts.max,
    maxPerSic: opts.maxPerSic,
    maxPerState: opts.maxPerState,
  });
  const counters = { read: 0, kept: 0, skipped: 0 };

  console.log(
    `Mode: sample max=${opts.max} maxPerSic=${opts.maxPerSic} maxPerState=${opts.maxPerState}${opts.dryRun ? " (dry-run)" : ""}`,
  );

  for (const file of opts.files) {
    if (budget.full) break;
    console.log(`→ scan ${path.basename(file)}`);
    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let headers: string[] | null = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!headers) {
        headers = parseCsvLine(line).map((h) => h.trim());
        continue;
      }
      if (budget.full) break;
      counters.read += 1;
      const lead = normalizeCompanyLeadRow(zipCsvRow(headers, parseCsvLine(line)));
      if (!lead) {
        counters.skipped += 1;
        continue;
      }
      if (budget.consider(lead)) counters.kept += 1;
      else counters.skipped += 1;
      if (counters.read % 50_000 === 0) {
        console.log(
          `  … ${path.basename(file)}: read=${counters.read} kept=${budget.size} ${JSON.stringify(budget.stats())}`,
        );
      }
    }
  }

  const selected = budget.selected();
  console.log("Sample ready", { ...counters, ...budget.stats(), selected: selected.length });
  if (opts.dryRun) return;

  const { prisma } = await import("../lib/db");
  if (opts.clear) {
    const deleted = await prisma.companyLead.deleteMany({});
    console.log(`Cleared existing leads: ${deleted.count}`);
  }

  const batchId = `sample-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  let inserted = 0;
  for (let i = 0; i < selected.length; i += FLUSH_BATCH) {
    const chunk = selected.slice(i, i + FLUSH_BATCH);
    const result = await prisma.companyLead.createMany({
      data: chunk.map((row) => ({
        ...row,
        sourceFile: "stratified-sample",
        importBatchId: batchId,
      })),
      skipDuplicates: true,
    });
    inserted += result.count;
    if ((i + FLUSH_BATCH) % 5000 < FLUSH_BATCH) {
      console.log(`  … inserted ${inserted}/${selected.length}`);
    }
  }

  console.log("Done", {
    batchId,
    inserted,
    tableCount: await prisma.companyLead.count(),
  });
  await prisma.$disconnect();
}

async function main() {
  const root = appRoot();
  const defaultDir = path.join(root, "storage", "company-leads");
  const dir = path.resolve(argValue("--dir") || process.env.COMPANY_LEADS_CSV_DIR || defaultDir);
  const dryRun = hasFlag("--dry-run");
  const clear = hasFlag("--clear") || !hasFlag("--no-clear");
  const sample = hasFlag("--sample");

  await mkdir(dir, { recursive: true });
  const files = await listCsvFiles(dir);
  if (files.length === 0) {
    console.error(`No CSV files in ${dir}`);
    process.exit(1);
  }

  console.log(`Dir: ${dir} (${files.length} files)`);

  if (sample) {
    await importSample({
      files,
      dryRun,
      clear,
      max: positiveInt("--max", DEFAULT_COMPANY_LEAD_SAMPLE.max),
      maxPerSic: positiveInt("--max-per-sic", DEFAULT_COMPANY_LEAD_SAMPLE.maxPerSic),
      maxPerState: positiveInt("--max-per-state", DEFAULT_COMPANY_LEAD_SAMPLE.maxPerState),
    });
    return;
  }

  await importAll({ files, dryRun, clear });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
