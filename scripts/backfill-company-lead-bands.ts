/**
 * Backfill `employeeBand` / `revenueBand` on existing company_leads rows.
 *
 * The import script derives the bands for new rows; this covers everything that
 * was imported before the bands existed — no CSV re-import required.
 *
 * Runs on the SERVER, after `prisma migrate deploy` (the columns must exist) and
 * from a build that has this schema (`prisma generate`). The dry-run is read-only
 * and prints the raw size values it cannot parse, so a CSV dialect can be checked
 * before writing anything.
 *
 *   npx tsx scripts/backfill-company-lead-bands.ts --dry-run
 *   npx tsx scripts/backfill-company-lead-bands.ts
 *
 * Performance shape matters here: `company_leads` holds millions of rows and
 * neither `employeeCount` nor `salesVolume` is indexed. One `UPDATE … WHERE
 * employeeCount = …` per distinct pair turns into one sequential scan per pair
 * (thousands of scans, hours of runtime on 4.8M rows). Instead every statement
 * ships a batch of pairs as a VALUES table and the planner does a single hash
 * join, so the table is scanned once per batch — a handful of passes in total.
 */

import "../lib/load-env";
import { Prisma } from "@prisma/client";
import { employeeBand, parseSizeValue, revenueBand } from "../lib/company-leads/bands";

/** Raw values are few and repeat; the report never dumps thousands of lines. */
const UNPARSED_SAMPLE = 20;

/**
 * Pairs per statement. Each pair averages ~1 400 rows here, so 150 pairs is a
 * ~200k-row transaction: small enough to keep WAL and lock volume sane on a
 * 4.8M-row table, large enough that the hash join is not dominated by setup.
 * Override with `--batch=…`.
 */
const DEFAULT_PAIRS_PER_STATEMENT = 150;

/** Postgres SQLSTATEs that are infrastructure problems, not data problems. */
const INFRA_ERRORS: Record<string, { label: string; advice: string }> = {
  XX002: {
    label: "index corruption",
    advice:
      "An index on company_leads is damaged: Postgres refuses to write through it. " +
      "This is a storage/infrastructure fault, not a bug in this script. " +
      "Run `npm run db:check-indexes` to list the damaged ones, rebuild them with " +
      "REINDEX INDEX CONCURRENTLY, and check the disk (dmesg) before re-running.",
  },
  "53100": {
    label: "disk full",
    advice:
      "Postgres ran out of space. A table-wide update roughly doubles the table and index " +
      "footprint until VACUUM runs. Free space, then re-run — completed batches are kept.",
  },
  "57P01": {
    label: "server shutting down",
    advice: "The connection was terminated. Re-run once Postgres is back up.",
  },
  "57014": {
    label: "statement cancelled",
    advice: "The statement was cancelled (timeout or manual). Re-run; completed batches are kept.",
  },
};

function errorCodeOf(error: unknown): string | null {
  const meta = (error as { meta?: { code?: unknown } })?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : null;
  return code;
}

function batchArg(fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith('--batch='));
  if (!hit) return fallback;
  const n = Number(hit.slice('--batch='.length));
  if (!Number.isInteger(n) || n < 1 || n > 2_000) {
    throw new Error('--batch must be an integer between 1 and 2000');
  }
  return n;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

type SizePair = {
  employeeCount: string | null;
  salesVolume: string | null;
  rows: bigint;
};

type BandRow = {
  employeeCount: string | null;
  salesVolume: string | null;
  employeeBand: number | null;
  revenueBand: number | null;
};

function describe(value: string | null): string {
  return value == null ? "(empty)" : JSON.stringify(value);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * One statement per batch. `IS NOT DISTINCT FROM` because both size cells are
 * nullable and a plain `=` never matches NULL — Prisma's `where: { x: null }`
 * already handled that, raw SQL has to say it explicitly.
 *
 * `updatedAt` is left untouched on purpose: the band is derived from a column
 * that did not change, so bumping the timestamp would look like a content edit.
 */
function updateStatement(batch: BandRow[]): Prisma.Sql {
  const values = Prisma.join(
    batch.map(
      (row) =>
        Prisma.sql`(${row.employeeCount}::text, ${row.salesVolume}::text, ${row.employeeBand}::int, ${row.revenueBand}::int)`,
    ),
  );
  return Prisma.sql`
    UPDATE company_leads AS c
    SET "employeeBand" = p.eb, "revenueBand" = p.rb
    FROM (VALUES ${values}) AS p(emp, rev, eb, rb)
    WHERE c."employeeCount" IS NOT DISTINCT FROM p.emp
      AND c."salesVolume" IS NOT DISTINCT FROM p.rev
      AND (
        c."employeeBand" IS DISTINCT FROM p.eb
        OR c."revenueBand" IS DISTINCT FROM p.rb
      )
  `;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const { prisma } = await import("../lib/db");

  // Group server-side: a multi-million-row table collapses to a few thousand
  // size pairs, so the write step only has to carry those.
  const pairs = await prisma.$queryRaw<SizePair[]>`
    SELECT "employeeCount", "salesVolume", COUNT(*)::bigint AS rows
    FROM company_leads
    GROUP BY 1, 2
  `;

  let totalRows = 0;
  let coveredRows = 0;
  const unparsed: Array<{ label: string; rows: number }> = [];
  const toWrite: BandRow[] = [];

  for (const pair of pairs) {
    const count = Number(pair.rows);
    totalRows += count;

    const employees = employeeBand(pair.employeeCount);
    const revenue = revenueBand(pair.salesVolume);
    const readable =
      parseSizeValue(pair.employeeCount) != null || parseSizeValue(pair.salesVolume) != null;

    if (readable) {
      coveredRows += count;
      toWrite.push({
        employeeCount: pair.employeeCount,
        salesVolume: pair.salesVolume,
        employeeBand: employees,
        revenueBand: revenue,
      });
      continue;
    }

    if (pair.employeeCount != null || pair.salesVolume != null) {
      unparsed.push({
        label: `employees=${describe(pair.employeeCount)} revenue=${describe(pair.salesVolume)}`,
        rows: count,
      });
    }
  }

  console.log("Size values in company_leads", {
    distinctPairs: pairs.length,
    rows: totalRows,
    rowsWithReadableSize: coveredRows,
    rowsWithoutSize: totalRows - coveredRows,
  });

  if (unparsed.length > 0) {
    unparsed.sort((a, b) => b.rows - a.rows);
    console.log(`Unparseable values (${unparsed.length} pairs, top ${UNPARSED_SAMPLE}):`);
    for (const row of unparsed.slice(0, UNPARSED_SAMPLE)) {
      console.log(`  ${row.rows} rows  ${row.label}`);
    }
    console.log(
      "These rows keep a null band and are dropped from every match proposal",
    );
  }

  const batches = chunks(toWrite, batchArg(DEFAULT_PAIRS_PER_STATEMENT));

  if (dryRun) {
    console.log("Dry run — nothing written.", {
      pairsToWrite: toWrite.length,
      rows: coveredRows,
      statements: batches.length,
    });
    await prisma.$disconnect();
    return;
  }

  let touchedRows = 0;
  const startedAt = Date.now();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!;
    const batchStart = Date.now();
    let count: number;
    try {
      // Idempotent: the WHERE clause skips rows already carrying these bands,
      // so an interrupted run resumes by simply running it again.
      count = await prisma.$executeRaw(updateStatement(batch));
    } catch (error) {
      const code = errorCodeOf(error);
      const known = code ? INFRA_ERRORS[code] : undefined;
      const batchesDone = i;
      console.error(
        `\nBackfill stopped at batch ${i + 1}/${batches.length}${code ? ` (SQLSTATE ${code})` : ""}.`,
      );
      if (known) {
        console.error(`Cause: ${known.label}. ${known.advice}`);
      } else {
        console.error(error);
      }
      console.error(
        `Committed so far: ${batchesDone} batch(es), ${touchedRows} rows. ` +
          "Nothing after this point was written; the table is consistent.",
      );
      await prisma.$disconnect().catch(() => {});
      process.exit(2);
    }

    touchedRows += count;
    const seconds = (Date.now() - startedAt) / 1000;
    const percent = Math.round(((i + 1) / batches.length) * 100);
    const rate = seconds > 0 ? Math.round(touchedRows / seconds) : 0;
    console.log(
      `  batch ${i + 1}/${batches.length} (${percent}%) pairs=${batch.length} rows=${count} ` +
        `total=${touchedRows} ${((Date.now() - batchStart) / 1000).toFixed(1)}s ` +
        `elapsed=${seconds.toFixed(0)}s rate=${rate}/s`,
    );
  }

  console.log("Done", {
    pairsWritten: toWrite.length,
    rowsUpdated: touchedRows,
    statements: batches.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
  console.log(
    "Reclaim the dead tuples (does not lock the table):\n" +
      "  docker compose exec postgres psql -U findmail -d findmail -c 'VACUUM (ANALYZE) company_leads;'",
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  const code = errorCodeOf(error);
  const known = code ? INFRA_ERRORS[code] : undefined;
  if (known) {
    console.error(`Backfill failed (SQLSTATE ${code}): ${known.label}. ${known.advice}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
