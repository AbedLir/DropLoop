import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "./postgres-client";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function listMigrations(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
}

export async function applyMigrations(sql: DatabaseClient): Promise<string[]> {
  await sql.unsafe(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedRows = (await sql.unsafe("select name from schema_migrations")) as unknown as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((row) => row.name));
  const executed: string[] = [];

  for (const migration of await listMigrations()) {
    if (applied.has(migration)) {
      continue;
    }

    const body = await readFile(join(migrationsDirectory, migration), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(body);
      await transaction.unsafe("insert into schema_migrations (name) values ($1)", [migration]);
    });
    executed.push(migration);
  }

  return executed;
}
