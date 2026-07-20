# ADR-0009: Private Immutable Provider-Output Delivery

Status: accepted

Date: 2026-07-16

## Context

Provider completion responses contain temporary result URLs, but P0-C needs durable, playable output that does
not depend on a provider URL remaining valid. The worker may crash between download, storage registration, and
state transition. Provider payloads and HTTP content types are also insufficient evidence that downloaded bytes
are a real video.

## Decision

- Persist the normalized provider result and provider latency on the attempt; raw responses remain diagnostic
  data and are not an execution contract.
- Download completed results only from credential-free HTTPS URLs, bound redirects and size, and classify
  transient HTTP failures separately from permanent invalid output.
- Validate downloaded bytes with `ffprobe` before accepting them as video. Share the probe implementation
  between Web ingestion and the worker.
- Address output objects by SHA-256 under
  `{owner}/{project}/outputs/{job}/{attempt}/{sha256}.{container}`, upload with overwrite disabled, and register them
  transactionally through a service-role-only database function.
- Use a deterministic asset ID per job attempt. The registration function is idempotent for the same immutable
  payload and rejects an attempt that is rebound to different bytes.
- Store the stable application preview route on clips. That authenticated route checks project RLS and redirects
  to a five-minute signed URL for the private bucket.
- Make `downloading` and `validating` lease-claimable. If registration commits before the worker advances state,
  a later worker resumes from the persisted output asset without overwriting or re-registering it.

## Consequences

- Provider URLs may expire without breaking an already registered DropLoop output.
- A valid provider status cannot bypass actual video-byte validation.
- Outputs stay private while browser video playback remains possible through short-lived authorization.
- Download and validation can recover after worker interruption without submitting another paid provider job.
- Storage integration requires the Supabase service-role environment only when a job reaches `downloading`; mock
  submission and provider contract tests remain zero-spend.
