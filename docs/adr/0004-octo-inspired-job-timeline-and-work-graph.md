# ADR-0004: Octo-Inspired Job Timeline and Minimal Work Graph

Status: accepted

Date: 2026-07-15

## Context

P0-B already makes a generation job durable, but a mutable status row alone cannot explain how a job reached its current state. It also cannot express that one job must wait for another while still allowing independent clips to run in parallel.

The referenced Octo material and the open-source `octo-matter` implementation treat a Matter as an atomic unit of work with a chronological timeline. Octo's broader orchestration model also distinguishes sequential Pipeline work from independent Split work. Those ideas map directly to DropLoop's generation, validation, review, repair, and export path, while Octo's IM, channel, general multi-agent, and preference-learning layers do not belong in P0-B.

References:

- [User-provided Octo reference](https://zhuanlan.zhihu.com/p/2025742871463047868)
- [Mininglamp-OSS/octo-matter](https://github.com/Mininglamp-OSS/octo-matter)
- [Mininglamp-OSS/octo-fleet](https://github.com/Mininglamp-OSS/octo-fleet)

## Decision

Treat each `generation_job` as DropLoop's Matter-like atomic work unit. The job row remains the current-state projection used for fast scheduling and reads.

Add an append-only `job_timeline_events` stream. Database triggers record job reservation, state transitions, lease changes, progress changes, and provider-attempt changes in the same transaction as the mutation. Raw provider responses are not copied into the timeline.

Add a minimal work graph:

- `solo` is one independent job.
- `pipeline` allows a job to depend on completed predecessor jobs.
- `split` groups independent jobs under one workflow so workers may claim them in parallel.

Workers may claim a job only when every declared dependency is completed. Dependencies must remain inside one project and workflow, and cyclic dependencies are rejected.

The existing `awaiting_review` state is the P0 human quality boundary. It preserves Octo's separation between execution and judgment without introducing autonomous multi-agent review in this milestone.

## Explicitly Deferred

- Channel, Thread, IM, and organization-wide bot identity.
- Roundtable and Swarm orchestration.
- Automated Critic agents; P0 review remains human-led.
- Taste or preference learning from review history.
- A general-purpose workflow DSL or separate orchestration service.

## Consequences

- A job's current state remains cheap to query, while its history is independently auditable.
- Pipeline and batch generation can share the same durable queue without claiming blocked work.
- Timeline writes cannot drift from state mutations because the database owns the event emission.
- The control plane gains a small DAG surface, so cycle, ownership, and cross-workflow validation are mandatory.
- User-facing clients receive read-only timeline access through project RLS; workers retain the mutation boundary.
- Future review learning can consume structured history without changing the P0 scheduler contract.
