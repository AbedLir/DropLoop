# ADR-0005: Supabase SSR identity and transactional Web writes

## Status

Accepted on 2026-07-16.

## Context

ADR-0003 established Supabase Postgres/Auth/Storage as the P0-B source of truth, but the Next.js API and dashboard still created a deterministic Demo Workspace on every request. Projects disappeared after refresh, review actions returned fabricated success responses, and no authenticated RLS path reached the database.

Project creation writes a parent project and multiple clips. A repair or regenerate review writes an audit row, changes clip/project state, and may enqueue a durable job. Implementing these as unrelated PostgREST calls would expose partial-write states.

## Decision

1. Next.js uses request-scoped `@supabase/ssr` clients backed by cookies. Middleware refreshes tokens and validates identity with `auth.getClaims()` before protected dashboard or API routes run.
2. Browser and user-facing server code use only the Supabase URL and publishable key. The service role and direct `DATABASE_URL` remain worker/migration-only secrets.
3. Dashboard and Projects/Review API reads use the authenticated client so row-level security remains the authorization boundary.
4. Multi-table writes use two narrow `security definer` functions that derive the caller from `auth.uid()` and explicitly verify ownership:
   - `create_project_with_clips`
   - `apply_clip_review_action`
5. Both operations require user-scoped idempotency keys. Repair and regenerate actions create durable jobs inside the same transaction as the audit and state changes.
6. Supabase packages are pinned to versions that support the repository's Node 20 CI baseline. Middleware uses the stable Next.js 15.5 Node.js runtime.

## Consequences

- Project and human-review state survives refreshes and process restarts.
- A failed multi-table write rolls back as one unit.
- Cross-user project, clip, review, job, and timeline access remains blocked by RLS and explicit RPC ownership checks.
- The current pipeline snapshot is still produced by the Mock Pipeline; P0-C will replace media generation without replacing the persistence boundary.
- Hosted verification still requires a real Supabase project URL, publishable key, and an Auth user. PostgreSQL CI verifies the same functions and RLS behavior without storing hosted credentials in GitHub.
