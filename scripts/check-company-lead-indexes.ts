/**
 * Check every btree index on company_leads for physical corruption.
 *
 * `amcheck`'s `bt_index_parent_check` walks the index and verifies that each
 * entry points at a real heap tuple. A corrupt index makes Postgres abort any
 * write that has to insert into it (SQLSTATE XX002), which is what stopped the
 * band backfill — so this has to be answered before writing again.
 *
 *   npx tsx scripts/check-company-lead-indexes.ts
 *
 * Read-only. No locks beyond a shared lock per index, so the app keeps serving.
 */

import "../lib/load-env";

type IndexRow = { relname: string };

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

function label(name: string): string {
  return `REINDEX INDEX CONCURRENTLY "${name}";`;
}

async function main() {
  const { prisma } = await import("../lib/db");

  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS amcheck");

  const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(
    `SELECT c.relname
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

  console.log(`Checking ${indexes.length} btree index(es) on company_leads…\n`);

  const broken: string[] = [];

  for (const index of indexes) {
    const startedAt = Date.now();
    let error: string | null = null;
    try {
      await prisma.$executeRawUnsafe(`SELECT bt_index_parent_check($1::regclass, true, true)`, index.relname);
    } catch (err) {
      // amcheck raises its own error on corruption; that is the signal, not a crash.
      if (sqlStateOf(err) === '42P01') {
        console.log("Table company_leads disappeared mid-check.");
        await prisma.$disconnect();
        return;
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

  console.log("");
  if (broken.length === 0) {
    console.log("All indexes are healthy. A XX002 was either transient storage trouble,");
    console.log("already rebuilt, or a different index — check dmesg for I/O errors.");
  } else {
    console.log(`${broken.length} corrupt index(es). Rebuild each one (no exclusive lock):\n`);
    for (const name of broken) console.log(`  ${label(name)}`);
    console.log("\nThen re-run: npm run db:backfill-bands");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
