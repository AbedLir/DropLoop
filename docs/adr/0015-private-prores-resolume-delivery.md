# ADR-0015: Private ProRes 4444 Resolume delivery

- Status: Accepted
- Date: 2026-07-20
- Scope: P0-D first professional-export vertical slice

## Context

Loop Doctor v3 now has separate machine evidence and a passed human visual review. The next unblocked product claim is not “show-ready export” in general; it is a traceable, professional media delivery for one exact approved asset.

The earlier export pages described presets and folders, but did not encode media, preserve/check Alpha, create a durable export job, or bind a package to the current immutable asset and loop analysis.

## Decision

The first Resolume delivery path is a single-clip, durable `export` job.

- The request can only select a human-approved clip whose current immutable output has current `boundary-seam-window-gray-v3` evidence with a `pass` decision.
- The job records the exact source asset and analysis IDs. A new source version cannot silently replace it.
- The worker locally transcodes the source into a QuickTime MOV using `prores_ks`, ProRes profile 4444 and a 12-bit 4:4:4 pixel format.
- Alpha is a measured property, not a requested label: an Alpha source must decode to Alpha in the MOV; an opaque source must remain opaque. Unknown or mismatched Alpha fails closed.
- The media file and `manifest.json` are written under a private, immutable export prefix. The manifest binds source hash, source analysis, ProRes probe, alpha state, v3 loop scores, and unresolved manual gates.
- The export completes only after the database confirms the uploaded media/manifest paths and their exact lineage.
- The authenticated owner can inspect durable delivery status and receives a five-minute signed redirect only for a completed MOV or manifest whose persisted delivery record still matches the exact immutable export prefix. Queued, failed, legacy, or substituted records do not expose a download URL.

## Consequences

This creates a real ProRes delivery artifact without claiming the broader P0-D result. The following remain explicit work:

- multi-clip folder assembly, thumbnails, BPM/beat reports, and fallback clips;
- manual import in Resolume and sustained 10-minute playback on target hardware;
- DXV3 licensing/SDK assessment and, if licensed, a separately verified encoder path;
- no Alpha creation for a source that is opaque.

The operator UI is deliberately not a playback or hardware-acceptance proxy. It exposes the source-of-truth queue state, private downloads after completion, and the manual Resolume/10-minute checklist; it does not mark those human gates complete.
