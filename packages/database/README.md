# DropLoop Database

Supabase Postgres is the P0-B source of truth for projects, assets, durable jobs, attempts, clips, reviews, and exports.

## Apply migrations

Set a server-only Postgres connection string, then run:

```bash
DATABASE_URL=postgres://... pnpm --filter @droploop/database migrate
```

The runner records each ordered SQL file in `schema_migrations` and applies a migration once inside a transaction.

## Security boundary

- Browser and user-facing API access must use the authenticated Supabase session so RLS applies.
- Workers use the service role only on the server.
- The service-role key and `DATABASE_URL` must never use a `NEXT_PUBLIC_` prefix or enter client bundles/logs.
- Project asset object paths must start with the authenticated user ID.

## Durable jobs

Workers claim one non-terminal job through `claim_generation_job(worker_id, lease_seconds)`. The function uses `FOR UPDATE SKIP LOCKED` and an expiring lease so a crashed worker does not permanently own a job.

Every provider submission uses a project-scoped idempotency key and creates a separate `job_attempts` record. Status changes must also pass the TypeScript state-machine guard and an optimistic database update.

## Integration verification

CI starts PostgreSQL 16 and runs:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/droploop \
  pnpm --filter @droploop/database test:integration
```

This executes the real migrations and verifies idempotent reservation, worker leasing, lease release, and owner-only project visibility under RLS.
