import { applyMigrations } from "./migrations";
import { createDatabaseClient } from "./postgres-client";

const sql = createDatabaseClient();

try {
  const applied = await applyMigrations(sql);
  console.log(applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is already up to date.");
} finally {
  await sql.end();
}
