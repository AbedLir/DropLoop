# ADR-0002: Provider-Driven Durable Job Pipeline

Status: accepted

Date: 2026-07-15

## Context

The repository defines a VideoProvider interface, but the main mock pipeline creates generated clips directly. API routes rebuild deterministic workspaces on every request, and the worker is a one-shot script.

Real video generation is asynchronous, costly, failure-prone, and too slow for a request-scoped in-memory workflow.

## Decision

All video generation and repair will run through an injected VideoProvider and a durable job state machine.

The pipeline owns product orchestration and validation. Providers own external submission, status translation, cancellation, and result retrieval. Database records are the source of truth for user-visible state.

Minimum job states:

- queued
- submitting
- provider_running
- downloading
- validating
- awaiting_review
- repairing
- exporting
- completed
- failed
- cancelled

Each attempt records an idempotency key, provider job ID, provider/model configuration, timestamps, error category, retry count, and cost.

## Consequences

- Direct clip creation inside product orchestration must be removed or confined to a provider-backed test fixture.
- Review actions become persisted commands rather than response-only mock data.
- Retries must be safe after worker or API restarts.
- Provider raw responses are retained for diagnostics but normalized schemas remain the application contract.
- Cost and entitlement accounting can be validated before final pricing is chosen.
