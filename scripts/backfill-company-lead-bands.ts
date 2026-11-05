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
 */

import "../lib/load-env";
import { employeeBand, parseSizeValue, revenueBand } from "../lib/company-leads/bands";

/** Raw values are few and repeat; the report never dumps thousands of lines. */
const UNPARSED_SAMPLE = 20;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

type SizePair = {
  employeeCount: string | null;
  salesVolume: string | null;
  rows: bigint;
};

function describe(value: string | null): string {
  return value == null ? "(empty)" : JSON.stringify(value);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const { prisma } = await import("../lib/db");

  // Group server-side: a 500k-row table collapses to a few hundred size pairs,
  // so the write step is a few hundred `updateMany` calls, not 500k updates.
  const pairs = await prisma.$queryRaw<SizePair[]>`
    SELECT "employeeCount", "salesVolume", COUNT(*)::bigint AS rows
    FROM company_leads
    GROUP BY 1, 2
  `;

  let totalRows = 0;
  let coveredRows = 0;
  let touchedRows = 0;
  const unparsed: Array<{ label: string; rows: number }> = [];
  const toWrite: Array<{
    employeeCount: string | null;
    salesVolume: string | null;
    employeeBand: number | null;
    revenueBand: number | null;
  }> = [];

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
      "These rows keep a null band: never excluded from a band filter, scored neutral (62/100).",
    );
  }

  if (dryRun) {
    console.log("Dry run — nothing written.", { pairsToWrite: toWrite.length, rows: coveredRows });
    await prisma.$disconnect();
    return;
  }

  // Idempotent: re-running rewrites the same values, so there is no need to read
  // the current bands back to detect drift.
  for (const pair of toWrite) {
    const result = await prisma.companyLead.updateMany({
      where: { employeeCount: pair.employeeCount, salesVolume: pair.salesVolume },
      data: { employeeBand: pair.employeeBand, revenueBand: pair.revenueBand },
    });
    touchedRows += result.count;
  }

  console.log("Done", { pairsWritten: toWrite.length, rowsUpdated: touchedRows, dryRun });
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
