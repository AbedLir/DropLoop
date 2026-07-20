# ADR-0003: Supabase Postgres Control Plane with Leased Jobs

Status: accepted

Date: 2026-07-15

## Context

P0-B needs user-owned projects and assets, durable asynchronous generation, idempotency, restart recovery, review history, and provider cost accounting. The repository already points to Supabase, Redis, and a worker, but none is connected.

Adding Postgres, object storage, authentication, and a separate Redis queue at the same time would create two distributed state systems before the first real provider path is proven.

## Decision

Use Supabase Postgres, Auth, and Storage as the P0-B source of truth.

Use `generation_jobs` as the first durable queue. Workers claim rows through a security-definer function using `FOR UPDATE SKIP LOCKED` and an expiring lease. Provider submission remains idempotent through a per-project idempotency key, and each external attempt is recorded separately.

Redis is not part of P0-B. It may be introduced later when measured queue throughput, scheduling, or fan-out requirements justify another stateful dependency.

User-facing access uses RLS. Workers use the server-only service role to claim and mutate jobs. Object paths begin with the authenticated user ID so Storage policies can enforce ownership.

## Consequences

- Project, asset, job, attempt, clip, review, and export state share one transactional source of truth.
- A crashed worker can be replaced after its lease expires without losing the job.
- The worker must renew or release leases and use optimistic status updates.
- Provider idempotency keys must be passed through on every submission path.
- Service-role credentials must never reach browser code or logs.
- Postgres polling is intentionally simple and must be instrumented before Redis is considered.
- Real Supabase migrations and RLS tests become part of the P0-B CI gate.
