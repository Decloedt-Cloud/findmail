/**
 * Check every btree index on company_leads for physical corruption.
 *
 * A corrupt index makes Postgres abort any write that has to insert into it
 * (SQLSTATE XX002) — that is what stopped the band backfill. This answers
 * "which index is broken?" before writing again.
 *
 *   npx tsx scripts/check-company-lead-indexes.ts          # bt_index_check, app stays up
 *   npx tsx scripts/check-company-lead-indexes.ts --full   # bt_index_parent_check, blocks writes
 *
 * The two amcheck functions are not interchangeable:
 *   - `bt_index_check` takes a lock on the index only and never blocks writes.
 *     It catches the common cases (bad tuple, wrong heap reference).
 *   - `bt_index_parent_check` also verifies the tree's internal structure
 *     (downlinks, no cycles), but holds a ShareLock on the whole table for the
 *     duration, so every INSERT/UPDATE/DELETE waits. Stop the app first.
 */

import "../lib/load-env";

type IndexRow = { oid: string; relname: string };

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Prisma hides the useful text in `meta.message`; fall back to the error itself. */
function describeError(error: unknown): string {
  const meta = (error as { meta?: { message?: unknown } })?.meta;
  const message =
    typeof meta?.message === 'string' ? meta.message : ((error as Error)?.message ?? String(error));
  return message.split('\n')[0]!.trim();
}

function sqlStateOf(error: unknown): string | null {
  const meta = (error as { meta?: { code?: unknown } })?.meta;
  return typeof meta?.code === 'string' ? meta.code : null;
}

/** Index names are case-sensitive, so the rebuild command must quote them. */
function rebuildCommand(name: string): string {
  return `REINDEX INDEX CONCURRENTLY "${name}";`;
}

async function main() {
  const { prisma } = await import("../lib/db");

  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS amcheck");

  // Index names like `company_leads_businessName_idx` carry capitals: a text
  // value cast to `regclass` is folded to lowercase, so `$1::regclass` resolves
  // `...businessname_idx` and fails with 42P01. Addressing each index by OID
  // sidesteps the naming rules entirely.
  const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(
    `SELECT c.oid::text AS oid, c.relname
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
      WHERE i.indrelid = to_regclass('company_leads')
        AND c.relkind = 'i'
        AND c.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')
      ORDER BY c.relname`,
  );

  if (indexes.length === 0) {
    console.log("No btree index found on company_leads (table missing, or not migrated yet).");
    await prisma.$disconnect();
    return;
  }

  const full = hasFlag("--full");
  const checkFn = full ? "bt_index_parent_check" : "bt_index_check";

  const [db] = await prisma.$queryRawUnsafe<{ name: string; version: string }[]>(
    "SELECT current_database() AS name, current_setting('server_version') AS version",
  );
  const [size] = await prisma.$queryRawUnsafe<{ rows: bigint; bytes: bigint }[]>(
    `SELECT (SELECT count(*) FROM company_leads) AS rows,
            pg_total_relation_size('company_leads') AS bytes`,
  );

  console.log(`Database ${db?.name} (PostgreSQL ${db?.version}), company_leads:`);
  console.log(
    `  ${Number(size?.rows ?? 0).toLocaleString("en-US")} rows, ` +
      `${(Number(size?.bytes ?? 0) / 1024 ** 3).toFixed(2)} GiB total (heap + indexes)`,
  );
  console.log(`\nChecking ${indexes.length} btree index(es) with ${checkFn}…`);
  if (full) {
    console.log(
      "  WARNING: --full holds a ShareLock on company_leads — writes are blocked until it ends.\n",
    );
  } else {
    console.log("  Read-only, does not block the app. Use --full to also verify tree structure.\n");
  }

  const broken: string[] = [];
  const skipped: string[] = [];

  for (const index of indexes) {
    const startedAt = Date.now();
    let error: string | null = null;
    try {
      await prisma.$executeRawUnsafe(`SELECT ${checkFn}($1::oid, true, true)`, index.oid);
    } catch (err) {
      // amcheck raises its own error on corruption; that is the signal, not a crash.
      if (sqlStateOf(err) === "42P01") {
        // The index was dropped between the catalogue read and the check.
        skipped.push(index.relname);
        console.log(`SKIP  ${index.relname}  (dropped during the check)`);
        continue;
      }
      error = describeError(err);
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (error) {
      broken.push(index.relname);
      console.log(`BAD   ${index.relname}  (${seconds}s)`);
      console.log(`      ${error}`);
    } else {
      console.log(`OK    ${index.relname}  (${seconds}s)`);
    }
  }

  const checked = indexes.length - skipped.length;

  console.log("");
  if (broken.length === 0) {
    console.log(`All ${checked} checked index(es) passed ${checkFn}.`);
    if (!full) {
      console.log(
        "Amcheck's structural checks only run with --full. If XX002 keeps happening while",
        "every index reports OK here, re-run with --full (app stopped) or rebuild the",
        "index named in the error — it may be structurally broken in a way only the",
        "parent check sees.",
      );
    } else {
      console.log("The indexes are structurally sound; look at the storage layer (dmesg, SMART).");
    }
  } else {
    console.log(`${broken.length} index(es) failed ${checkFn}.\n`);

    if (broken.length === 1) {
      console.log(`Rebuild it:\n\n  ${rebuildCommand(broken[0]!)}\n`);
    } else {
      // One table-wide command beats N index rebuilds: same result, one pass over
      // the table, and no chance of re-running before the last index is fixed.
      console.log("Rebuild them all in one pass — the shorter route when several are broken:\n");
      console.log("  REINDEX TABLE CONCURRENTLY company_leads;   -- keeps the app serving");
      console.log("  REINDEX (VERBOSE) TABLE company_leads;      -- faster, blocks writes\n");
      console.log("Or individually:\n");
      for (const name of broken) console.log(`  ${rebuildCommand(name)}`);
      console.log("");
    }

    console.log(
      "CONCURRENTLY does not lock out writes. It needs free space for a second copy",
      "of one index at a time, and it leaves an INVALID index behind if it fails",
      "(DROP it, re-run). A UNIQUE index also fails here if the heap holds real",
      "duplicates — check before rebuilding an *_key index.",
    );
    console.log("\nThen: npm run db:check-indexes, then npm run db:backfill-bands");
  }

  await prisma.$disconnect();
  // Non-zero on corruption so a deploy step can gate on it.
  if (broken.length > 0) process.exitCode = 3;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
