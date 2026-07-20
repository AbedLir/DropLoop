# ADR-0007: BPM analysis and selection provenance

## Status

Accepted on 2026-07-16.

## Context

DropLoop previously treated a BPM typed into the project form as if it represented media intelligence. P0-C requires an analyzed value and confidence derived from uploaded audio, while still allowing a DJ/VJ to override imperfect automatic analysis. The selected value and its source must remain distinguishable.

## Decision

1. After `ffprobe` validates source audio, the Web Node route uses `ffmpeg` to decode at most the first 180 seconds to mono 11,025 Hz float PCM.
2. `onset-autocorrelation-v1` builds a short-time energy onset envelope and searches a documented 60–200 BPM range. Near-equal harmonic candidates prefer double time, recorded as the `constant-tempo-double-time-tie-break` beat-grid assumption.
3. Insufficient, silent, or weakly periodic audio produces `analyzedBpm = null` and confidence `0`; the system does not fabricate a fallback analysis.
4. The immutable source asset stores analyzed BPM, confidence, algorithm version, and beat-grid assumption. A trigger synchronizes the latest source-audio analysis to the owner project.
5. The project separately stores the selected BPM and `analysis` or `manual_override` provenance. `set_project_bpm_selection` verifies ownership and only permits analysis selection when the requested integer equals the rounded value from that exact source asset.
6. The project page displays selected and analyzed values side by side and lets the authenticated owner switch provenance explicitly.

## Consequences

- Form input is no longer presented as measured audio metadata.
- Low-confidence and tempo-changing tracks remain visible as uncertain rather than silently normalized.
- The first algorithm assumes a constant tempo and does not yet estimate beat phase, downbeats, or tempo sections. Those require a later analysis version and preserved provenance rather than an in-place reinterpretation.
- Deployment now requires both `ffprobe` and `ffmpeg`, configurable with `FFPROBE_PATH` and `FFMPEG_PATH`.
