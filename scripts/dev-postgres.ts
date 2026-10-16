import "../lib/load-env";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { paths } from "../lib/paths";

const port = Number(process.env.LOCAL_POSTGRES_PORT || 5433);
const databaseDir = path.join(paths.postgres, "embedded");

async function main() {
  const postgres = new EmbeddedPostgres({
    databaseDir,
    user: "findmail",
    password: "findmail",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  try {
    await postgres.initialise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exists/i.test(message)) throw error;
  }
  await postgres.start();
  try {
    await postgres.createDatabase("findmail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  }
  console.log(`PostgreSQL listening on 127.0.0.1:${port}, database findmail`);
  console.log("Leave this process running while you use the app.");
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
