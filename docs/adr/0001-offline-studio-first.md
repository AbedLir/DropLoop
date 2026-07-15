# ADR-0001: Offline Studio First

Status: accepted

Date: 2026-07-15

## Context

Current real-time AI video tools report or exhibit multi-second latency, while live VJ operation depends on beat-accurate response and predictable output. Research participants consistently separated high-risk creative generation from the zero-tolerance live playback chain.

The repository already models stage preview and live-oriented concepts, which could incorrectly pull the MVP toward a live AI control product.

## Decision

DropLoop will generate and process VJ assets offline.

The first MVP ends at a validated, professionally encoded file package that can be imported into existing live tools. AI generation is not a runtime dependency during a show.

Real-time generation is a separate future product line with its own latency, reliability, fallback, and operator-control acceptance criteria.

## Consequences

- Professional export, seamless loops, alpha, and style control are product P0.
- Resolume import is an acceptance test, not merely an export preset label.
- TouchDesigner, Spout, NDI, Syphon, MIDI, and OSC integrations may follow after the stable file path.
- The application should never imply that a mock preview or synthetic score is show-safe.
- Cloud generation is acceptable when the final show artifact is a validated local file.
