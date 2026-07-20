# ADR-0011: Exact repair asset and evidence lineage

- Status: Accepted
- Date: 2026-07-17
- Scope: P0-D Loop Doctor repair handoff

## Context

Human Review could create a durable `repair` job containing only Clip and Review identifiers, while the Worker expected a fabricated `GeneratedClip` payload that the RPC never stored. Even if a provider repair endpoint had been enabled, the job did not identify which immutable video version or which loop-analysis result motivated the repair. A later output could therefore not prove a before/after relationship.

## Decision

Postgres is the enforcement boundary for repair lineage:

- every new repair Job binds one ready `generated_output` Asset and the latest persisted Loop Analysis for that exact Asset;
- a Clip repair action always binds `clips.current_asset_id`; a caller cannot substitute an older or foreign Asset;
- both identifiers are stored in typed Job columns and copied into Job input for audit readability;
- a repair output is a new immutable Asset with a monotonically increasing Clip version and `parent_asset_id` pointing to the exact source;
- the after Analysis stores `source_analysis_id`, creating a direct before/after evidence edge;
- registering an output or Analysis with inconsistent Project, Clip, Asset, Job, or evidence lineage fails closed.

Database triggers apply the same rules to authenticated Review RPC writes, service-side repository writes, and future orchestration paths. The Web route is not trusted to construct lineage correctly.

The Provider contract now carries source Asset and Analysis IDs instead of a synthetic `GeneratedClip`. It does not expose permanent Storage paths or credentials. A future verified adapter may resolve a short-lived source URL immediately before submission.

## Consequences

Review requests are reproducible and repair results cannot overwrite their source. Worker recovery preserves the chosen input version even if a newer Clip version appears later. Before/after metrics can be audited without parsing URLs or mutable UI state.

This ADR does not claim that Seedance or Kling repair is implemented. Their repair methods remain disabled until the actual endpoint, authentication, source-video delivery, pricing, and output behavior are verified. The current slice establishes the secure handoff and version/evidence model needed by a real repair implementation.
