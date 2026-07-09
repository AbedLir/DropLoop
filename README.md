# DROPLOOP

DROPLOOP is an AI VJ Pack Builder for DJs, VJs, clubs, festivals, and live event visual teams.

It turns tracks, moods, references, and show constraints into stage-ready VJ pack plans, mock clips, loop scores, stage previews, and export manifests.

## MVP Direction

- Build the full structured workflow before real video generation.
- Validate every AI pipeline output with shared Zod schemas.
- Keep video generation behind a provider adapter.
- Use `MockVideoProvider` first; keep `SeedanceProvider` as an isolated stub.
- Route long-running work through worker-style job handlers.

## Local Development

```powershell
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm typecheck
pnpm dev
```

## Repository Layout

```text
apps/web        Next.js App Router dashboard and API shell
apps/worker     Mock async pipeline and video provider adapter
packages/schemas Shared Zod schemas and TypeScript types
packages/prompts Structured prompt builders
packages/ui      Shared design tokens and lightweight UI primitives
packages/database SQL schema and seed data
docs             Product and architecture docs
assets           Brand/demo fixtures
tests            Integration and e2e test placeholders
```
