# ADR-0008: Explicit Dual Video-Provider Contracts

Status: accepted

Date: 2026-07-16

## Context

P0-C needs a real provider path for Seedance 2.0 and Kling without letting provider-specific authentication,
status names, or response bodies leak into the durable control plane. Video calls incur cost, and changing a
deployment's default provider must not cause an existing provider job to be polled through a different API.

Seedance 2.0 and Kling also do not expose identical capabilities. In particular, the stable Kling text-to-video
contract does not document a task-cancellation operation, and Kling 3.0 Omni uses a newer contract than the
stable v2.1 Master text-to-video endpoint.

## Decision

- Keep `VIDEO_PROVIDER=mock` as the default so local runs and CI cannot spend provider credits.
- Implement Seedance 2.0 against the Ark v3 task API with model `doubao-seedance-2-0-260128`.
- Implement the stable Kling text-to-video adapter with model `kling-v2-1-master`; keep the model configurable,
  but do not send Kling 3.0 Omni identifiers through the older endpoint.
- Require explicit credentials whenever a production provider is selected. Never use an `unconfigured` model
  sentinel or silently fall back to mock after configuration failure.
- Normalize submission, polling, errors, and result URLs into the shared provider schemas while retaining a
  sanitized raw response for diagnostics.
- Preserve provider affinity: queued jobs without a provider use the deployment default, while submitted or
  retried jobs use the provider already persisted on the job.
- Test both adapters through an injected HTTP transport. Contract tests use fixture responses and cannot make
  live provider calls.
- Fail closed when the shared interface requests a provider capability that has no verified external endpoint.

## Consequences

- Seedance and Kling can share the same durable job state machine without sharing authentication or response
  parsing code.
- CI verifies payloads, JWT construction, status mapping, rate-limit classification, and provider affinity at
  zero provider cost.
- A separate adapter contract is required for Kling 3.0 Omni instead of treating it as a model-name-only upgrade.
- P0-D must add durable source-video handoff before either adapter can implement real loop repair.
