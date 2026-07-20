# ADR-0010: Versioned decoded loop-boundary evidence

- Status: Accepted
- Date: 2026-07-17
- Scope: P0-D Loop Doctor quality gate, first vertical slice

## Context

The durable worker previously moved a downloaded provider output from `validating` to `awaiting_review` after checking only that an immutable asset ID existed. The review UI could therefore display a synthetic `loop_score` as if it were evidence derived from the delivered video. That is not an acceptable basis for a VJ-ready or show-safe claim.

## Decision

Validation must read the private immutable provider output and decode its first and final displayed frames with FFmpeg. Version `boundary-gray-mae-v1` scales each frame to a 64 × 64 grayscale plane and records:

- normalized per-pixel mean absolute error across the loop boundary;
- mean luma of both boundary frames;
- absolute boundary brightness jump;
- black/near-black classification for each boundary frame;
- the exact policy, algorithm version, decision, and human-readable reasons.

The initial policy is explicit and persisted with every analysis:

- boundary MAE must be at most 12%;
- brightness jump must be at most 8%;
- mean luma at or below 2% is treated as black or near-black.

These values are provisional product thresholds, not hidden constants. They must be calibrated with representative Seedance 2.0 and Kling outputs before the product makes show-safe claims.

An analysis is immutable and unique for `(job, asset, algorithm version)`. Its identifier is deterministic, so a worker can resume after a crash without duplicating evidence. A job cannot leave `validating` until evidence for its current `output_asset_id` has been persisted. Both pass and repair-required results go to human review; a failed gate recommends repair and never silently replaces the source asset.

## Security and integrity

- The worker reads the existing private `project-assets` object with the service role.
- Registration is service-role-only and verifies that the job is validating the exact generated asset linked to it.
- Project owners can read analysis rows through RLS; they cannot insert or mutate them.
- The database updates the clip's loop score, recommendation, and reason from persisted decoded evidence rather than browser or provider claims.

## Consequences

This closes the false-positive path where an immutable file alone counted as validated. It does not yet establish full VJ safety. Representative-frame flicker analysis, professional alpha verification, repair output versioning, ProRes 4444 encoding, DXV3 feasibility, package generation, and the Resolume ten-minute acceptance run remain separate P0-D gates.

The first/last grayscale metric is intentionally explainable and reproducible. A later algorithm may add perceptual or motion-window metrics, but it must use a new version and preserve prior evidence.
