import "../lib/load-env";
import { prisma } from "../lib/db";
import { mergeDuplicateBrandIcps } from "../lib/icp/merge-duplicates";

async function main() {
  const merged = await mergeDuplicateBrandIcps();
  if (merged.length === 0) {
    console.log("No duplicate ICPs to merge.");
    return;
  }
  for (const row of merged) {
    console.log(`${row.brandName} · ${row.host}: kept ${row.keptId}, removed ${row.removed}, creators moved ${row.creatorsMoved}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "ICP merge failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
