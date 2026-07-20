# ADR-0012: Versioned local Loop Doctor transform

- Status: Accepted
- Date: 2026-07-17
- Scope: P0-D first real repair implementation

## Context

DropLoop could identify a bad decoded seam, bind the exact immutable source Asset and Analysis, and preserve repair lineage, but it still could not transform video. Seedance 2.0 and Kling remain generation targets; neither adapter has a verified repair endpoint, source-video contract, or approved spend path. Treating a synthetic URL or an unverified provider response as a repair would break the evidence chain.

The current MVP is an offline VJ preparation workflow. A deterministic local media transform is therefore a useful zero-cost baseline and a safe fallback for measuring whether a repair actually improves the decoded loop boundary.

## Decision

The default repair engine is the versioned local policy `cyclic-boundary-crossfade-v1`:

- use the last 0.5 seconds and first 0.5 seconds as a cyclic crossfade;
- concatenate the untouched middle with that crossfade;
- retime the result to preserve the source duration;
- encode H.264 with `libx264`, CRF 18, `medium`, and `yuv420p`;
- strip embedded audio because DropLoop synchronizes separate project music in this phase;
- reject alpha input rather than silently destroying alpha;
- preserve the source Asset and register the output as a new immutable version;
- persist the complete transform policy, source Asset/Analysis IDs, output SHA-256, zero cost, and processing latency on the durable attempt.

The Worker uses the existing `repairing` state, lease recovery, attempt timeline, private object store, output registration, and Loop Analysis path. A completed output registration can resume directly into validation after a worker crash. Storage or database failures remain retryable on the same deterministic attempt; invalid source lineage, unsupported alpha, malformed media, or duration drift fail closed.

`LOOP_REPAIR_ENGINE=local` is the default. `provider` remains an explicit opt-in route, but Seedance and Kling repair calls stay disabled until their contracts and spend are separately verified.

## Consequences

DropLoop now has a real no-spend repair path with measurable before/after decoded evidence. The v1 transform is intentionally narrow: it does not promise motion-aware interpolation, audio continuity, Alpha preservation, ProRes 4444, or DXV3 output. Those remain later policies and acceptance gates rather than hidden behavior in v1.
