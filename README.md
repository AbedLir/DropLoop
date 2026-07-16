# DROPLOOP

DROPLOOP is an AI VJ Pack Builder for DJs, VJs, clubs, festivals, and live event visual teams.

It turns tracks, moods, references, and show constraints into stage-ready VJ pack plans, mock clips, loop scores, stage previews, and export manifests.

## MVP Direction

- Build the full structured workflow before real video generation.
- Validate every AI pipeline output with shared Zod schemas.
- Keep video generation behind a provider adapter.
- Keep `MockVideoProvider` as the no-spend default; opt into Seedance 2.0 or Kling explicitly.
- Route long-running work through worker-style job handlers.

## Local Development

```powershell
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm typecheck
pnpm test:unit
pnpm build
pnpm dev
```

Run the full local verification gate with:

```powershell
pnpm verify
```

Apply the Supabase/Postgres control-plane migrations with a server-only `DATABASE_URL`:

```powershell
pnpm --filter @droploop/database migrate
```

Authenticated Web routes use Supabase SSR cookies and owner-only RLS. Configure the public project URL and publishable key before opening `/dashboard`:

```powershell
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The publishable key is safe to expose to the browser because authorization is enforced by Auth and RLS. Never expose `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL` through a `NEXT_PUBLIC_` variable.

Real source uploads are private, limited to 64 MiB per file, and inspected from bytes before registration. Source audio BPM analysis decodes a bounded PCM window. The Web runtime must have `ffprobe` and `ffmpeg` on `PATH`, or configure their absolute executable paths:

```powershell
FFPROBE_PATH=ffprobe
FFMPEG_PATH=ffmpeg
```

Production video submission is disabled by default. Set `VIDEO_PROVIDER=seedance` with an Ark API key, or
`VIDEO_PROVIDER=kling` with Kling access and secret keys. Once a job is submitted, the worker preserves the
provider recorded on that job even if the deployment default changes. See `.env.example` for model IDs and base URLs.

## Repository Layout

```text
apps/web        Next.js App Router dashboard and API shell
apps/worker     Durable worker and mock/Seedance/Kling provider adapters
packages/schemas Shared Zod schemas and TypeScript types
packages/prompts Structured prompt builders
packages/ui      Shared design tokens and lightweight UI primitives
packages/database SQL schema and seed data
docs             Product and architecture docs
assets           Brand/demo fixtures
tests            Integration and e2e test placeholders
```

## Project Documentation

- [Latest research baseline](docs/product/latest-research-baseline.md)
- [MVP acceptance criteria](docs/product/mvp-acceptance.md)
- [Architecture decisions](docs/adr/README.md)
