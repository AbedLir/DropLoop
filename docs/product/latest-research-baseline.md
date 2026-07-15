# Latest Research Baseline

Status: active

Research date: 2026-07-15

Repository: [AbedLir/DropLoop](https://github.com/AbedLir/DropLoop)

## Research sources

The current baseline is synthesized from the latest focus-group summary, a ten-page product-direction validation report, and a seven-minute research audio narrative.

Source files are stored in the project Drive:

- [2026-07-15 MVP direction validation](https://drive.google.com/drive/folders/11c9v4ufD7T7fOmnnwvgMQhy7zdmLHekF)
- [Discussion summary](https://drive.google.com/file/d/1-zF9MU3Pl0nXjtTVz47lfoASjKkc3V8d/view)
- [Validation report](https://drive.google.com/file/d/1jkf6YTrDMfUrFJKxl9c2XPAGjnuuiIP2/view)
- [Research audio](https://drive.google.com/file/d/1fofhAIxE53fP_RdUzWqfvq9x5ecg-5oG/view)

An additional architecture reference was added after the initial research synthesis:

- [Octo reference supplied by the product owner](https://zhuanlan.zhihu.com/p/2025742871463047868)
- [Octo Matter implementation](https://github.com/Mininglamp-OSS/octo-matter)

DropLoop adopts the narrow concepts that strengthen the offline production path: a durable work item with a traceable timeline, sequential Pipeline dependencies, parallel Split batches, and a separate human judgment boundary. It does not adopt Octo's IM surface or become a general multi-agent collaboration platform.

## Product decision

DropLoop is an offline VJ content-production workbench, not a live AI performance engine.

AI runs during show preparation. Live performance continues to use validated local files and established playback/control software. Real-time generation remains a separate future product line until it meets live-performance latency and reliability requirements.

## Validated problem

The largest repeatable cost is the preparation workflow:

1. Collect or render source material.
2. Generate and curate visual variants.
3. Repair first/last-frame continuity.
4. Normalize resolution, frame rate, and codec.
5. Produce clean alpha output where required.
6. Classify assets and attach BPM or operator metadata.
7. Package files for Resolume or another playback system.

General AI video tools produce source material, but they do not complete this VJ-specific chain.

## Evidence tiers

### Tier 1: shared evidence that defines MVP

- Batch AI generation with reference-driven style control.
- DXV3 or ProRes 4444 professional export.
- Correct alpha-channel output.
- Seamless-loop detection and repair.
- Stable file-based handoff into Resolume.
- Creator control over palette, motion language, intensity, and variation.

### Tier 2: strong segmented needs

- BPM metadata and batch pack management are especially valuable to DJ/VJ and newer users.
- Local execution, MIDI/OSC mapping, auditability, and predictable failure behavior matter most to large-show operators.
- Audio-reactive preview can improve perceived rhythm fit without becoming a live-generation dependency.
- TouchDesigner, Spout, NDI, and Syphon reduce handoff friction, but do not block the first file-based MVP.

### Tier 3: hypotheses that require experiments

- Free tier with limited MP4 export.
- Compute-credit purchases unlocking professional outputs.
- Studio subscription with priority capacity, collaboration, and API access.
- Example audio-narrative price anchors such as a base purchase, per-generation credits, or a monthly unlimited plan.

These are not final prices. The application must record real provider cost and entitlement usage before pricing is committed.

## User segments

### Show operator / technical director

Priorities: deterministic output, local playback, professional formats, fallback media, and zero live dependency on generation.

### Independent or art-led VJ

Priorities: style fidelity, controllable variation, cost efficiency, and reduced manual post-processing.

### DJ/VJ or newer creator

Priorities: BPM-aware packs, batch organization, low learning cost, and pay-for-use economics.

## Explicit non-goals for the first MVP

- Sub-second live video generation.
- Replacing Resolume, TouchDesigner, or VDMX as the live control surface.
- Automatic live-show decision making.
- A broad multi-provider marketplace before one provider completes the vertical slice.
- Treating mock scores or generated metadata as proof that real media passed a quality gate.

## Current repository gap

The repository has a strong structured prototype: Zod schemas, mock pipeline stages, a provider interface, quality-gate concepts, an export manifest, and a dashboard shell.

It does not yet ingest real media, persist real jobs, invoke a production video provider, measure real pixels/audio, repair actual loops, encode professional output, or prove a Resolume import. The next milestone must close one real end-to-end path rather than add more mock surfaces.
