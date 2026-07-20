# DropLoop agent rules

## Product guardrails

- Keep DropLoop an evidence-led, offline-first VJ production workflow.
- Do not fabricate successful media output, provider state, safety claims, or visual acceptance.
- Keep Seedance and Kling on their explicit no-spend/verified-contract path. Do not make live provider calls without the user's authorization.
- Treat machine evidence and human acceptance as separate gates.

## Mandatory skill routing

Apply these rules automatically for every task in this repository. Do not wait for an explicit `$skill` mention.

| Trigger | Required skill | Required outcome |
| --- | --- | --- |
| New feature, changed product scope, metric, workflow, model/provider behavior, or acceptance criterion | `$grill-me` before implementation | State `Proceed`, `Proceed with assumptions`, or `Blocked`; surface only material unresolved decisions. |
| Any non-trivial feature, bug fix, CI failure, PR work, or refactor | `$gstack` from planning through handoff | Define targeted regression coverage, run proportional QA, update relevant docs, and report exact evidence. |
| Any user-facing page, component, media control, interaction, animation, layout, or acceptance preview | `$apple-design` before editing and before handoff | Preserve direct feedback, accessibility/reduced-motion behavior, and visually verify the affected interaction. |

If more than one row applies, run `$grill-me` first, then `$gstack`; use `$apple-design` inside the UI portion of the delivery loop. A task is not complete until all applicable skill outcomes have been recorded in the handoff.

## Verification and handoff

- Run the narrowest relevant test before broader checks.
- For media-loop work, name the exact claim being tested: endpoint similarity, seam-window motion continuity, or full-clip safety. Never substitute one for another.
- Preserve unrelated user changes and do not publish, merge, deploy, or delete external state without explicit authorization.
