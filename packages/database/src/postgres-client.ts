import postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export function createDatabaseClient(connectionString = process.env.DATABASE_URL): DatabaseClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the durable DropLoop control plane.");
  }

  return postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  });
}
