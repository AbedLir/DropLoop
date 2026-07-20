# ADR-0014: Seam-window loop continuity gate

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-0010 endpoint-only boundary evidence for the current validation gate
- Scope: P0-D Loop Doctor seam acceptance

## Context

`boundary-temporal-gray-v2` retained the explainable first/final-frame MAE gate and added full-clip brightness and flicker evidence. It could still pass a clip whose end-to-start transition looked like a reset in motion: a single pair of endpoint frames cannot establish whether movement continues through the loop boundary.

Full-clip safety evidence remains useful, but it is not the same claim as a seamless loop. An unrelated interior cut must not be treated as a loop-boundary failure merely because it appears inside the clip.

## Decision

The current policy is `boundary-seam-window-gray-v3`. It retains decoded endpoint, black-frame, brightness, and flicker evidence, and adds a bounded temporal seam evaluation:

- sample the full immutable clip at up to 12 fps / 240 frames to establish normal in-clip motion;
- decode a 0.5-second representative window at both the tail and head of the loop;
- compare the final displayed frame to the first displayed frame as a spatial transition;
- compare that transition against the full clip's 95th-percentile adjacent-frame MAE, rejecting an outlier above 2.5×;
- measure temporal acceleration on both sides of the tail-to-head join and compare it against the full clip's 95th-percentile motion-jerk baseline, rejecting an outlier above 3×;
- persist the window size, raw metrics, baselines, ratios, continuity score, policy, decision, and reasons in the immutable analysis evidence.

The implementation deliberately treats the full clip as a robust baseline rather than as a list of disallowed edits. The seam itself is the decision target.

## Consequences

Jobs require v3 evidence before entering Human Review. The local Loop Doctor acceptance fixture now uses one continuous four-second source with a deliberately non-looping end-to-start brightness/motion drift; it contains no interior hard cut. The repair must change that source from `repair_required` to `pass` under the same v3 analyzer.

This is still a deterministic heuristic, not perceptual video understanding, a medical photosensitivity assessment, or a show/venue certification. Human playback review remains a separate acceptance gate.
