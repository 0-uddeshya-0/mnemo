/**
 * Apply every .sql file in ./drizzle in lexical order, idempotently. Uses the simple
 * query protocol so multi-statement files (incl. dollar-quoted functions) run as-is.
 *
 *   pnpm db:migrate
 */
import "@/lib/server/load-env";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (check your .env).");

  const drizzleDir = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
  const files = (await readdir(drizzleDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("No .sql migration files found in", drizzleDir);
    return;
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const file of files) {
      const text = await readFile(join(drizzleDir, file), "utf8");
      process.stdout.write(`→ applying ${file} … `);
      await sql.unsafe(text).simple();
      console.log("ok");
    }
    console.log(`\n✓ Applied ${files.length} migration file(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n✗ Migration failed:\n", err);
  process.exit(1);
});
