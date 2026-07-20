# MVP Acceptance Criteria

Status: proposed baseline

Research date: 2026-07-15

## Success statement

A VJ can submit music context and visual references, receive multiple style-consistent loop variants, review or repair them, and download a package that imports directly into Resolume without running AI during the show.

## Gate 0: engineering baseline

- A clean checkout installs with the locked pnpm version.
- Typecheck, tests, and production build run on Windows and Linux.
- GitHub Actions runs the same verification gate for pull requests.
- Product decisions and ADRs are versioned with code.

## Gate 1: real input and durable project state

- The user can upload one audio file and multiple visual references.
- Files are stored outside the application process and linked to a persisted project.
- Media duration, resolution, frame rate, codec, and alpha presence are extracted from the real file.
- BPM supports an analyzed value, confidence, and manual override.
- Project, asset, job, clip, review, and export state survive refreshes and service restarts.

## Gate 2: real provider execution

- One production provider is integrated through the shared provider interface.
- Submit, poll, cancel, retry, timeout, and terminal failure states are persisted.
- Idempotency prevents duplicate generation and duplicate cost from a repeated request.
- Provider name, model, duration, attempt count, latency, raw job identifier, and cost are recorded.
- The user receives at least one real playable preview.

## Gate 3: VJ-specific media quality

- Loop continuity is measured from real frames rather than a fixed score.
- Repair produces a new version and preserves the source asset.
- Alpha presence and interpretation are verified from the encoded output.
- Resolution, frame rate, black frames, brightness discontinuity, and unsafe flicker are checked.
- Quality-gate results link to measurable evidence and thresholds.

## Gate 4: professional export

- ProRes 4444 with alpha is a supported acceptance path.
- A first delivery may cover one exact human-approved clip, but must bind the private MOV and manifest to its immutable asset hash and current loop evidence.
- Alpha must be decoded and verified in both source and delivery output; an opaque source must not be labeled as Alpha-capable.
- DXV3 licensing and encoder integration have a recorded outcome; HAP or ProRes may be an interim path when documented.
- The package contains approved media, thumbnails, manifest, BPM/beat notes, safety report, and fallback/operator notes.
- Files import into Resolume without manual transcoding.
- A representative loop plays continuously for ten minutes without a black frame, obvious seam, brightness jump, or alpha error.

## Gate 5: pilot validation

- At least one operator, one independent/art-led VJ, and one DJ/VJ or newer creator complete a real task.
- The team records preparation time, first-pass usability, repair count, export success, provider cost, and willingness to use or pay again.
- Pricing remains a hypothesis until real cost and pilot behavior are available.

## Metrics that do not prove MVP completion

- Number of dashboard pages.
- Number of deterministic pipeline stages marked completed.
- Mock clip count.
- Synthetic loop, safety, or stage-readability scores.
- Placeholder plan prices.
