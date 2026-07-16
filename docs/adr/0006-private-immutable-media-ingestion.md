# ADR-0006: Private immutable media ingestion with trusted probing

## Status

Accepted on 2026-07-16.

## Context

P0-C must replace metadata-only references with real user-owned media. A browser MIME value or filename is not proof that bytes contain usable audio, an image, or a video. Direct client inserts into `project_assets` would also allow callers to fabricate duration, dimensions, codec, and ownership metadata.

The first vertical slice needs one narrow ingestion path that is testable before a production generation provider is allowed to spend compute.

## Decision

1. The authenticated Next.js Node route accepts one multipart asset at a time and limits the request to 64 MiB.
2. The route allows a fixed MIME set and verifies the actual temporary file with `ffprobe`. Audio requires a decodable audio stream and duration; images require a visual stream and dimensions; videos additionally require duration and frame rate.
3. Source bytes are stored in the private `project-assets` bucket under `user-id/project-id/sources/asset-id/safe-filename` with overwrite disabled.
4. The SHA-256 digest, normalized probe result, codec, duration, dimensions, frame rate, pixel format, and alpha presence are persisted through `register_project_asset`.
5. The database function derives identity from `auth.uid()`, verifies project ownership and the exact object path, checks that the Storage object exists, and makes retries by asset ID idempotent.
6. Authenticated callers cannot directly insert or update asset rows, and Storage object updates are denied. A changed source becomes a new asset ID/version instead of overwriting history.
7. The Web route removes an uploaded object if relational registration fails.

## Consequences

- Media metadata is derived from uploaded bytes rather than form placeholders.
- Private source ownership is enforced in both Storage and Postgres.
- Duplicate project content is rejected by a project-scoped SHA-256 uniqueness constraint.
- The route currently buffers at most 64 MiB and depends on an available `ffprobe` executable. Larger resumable uploads and a dedicated probing worker are deferred until the first provider path proves the workload.
- BPM analysis, selected-BPM provenance, production provider submission, result download, and playable preview derivatives remain later P0-C slices.
