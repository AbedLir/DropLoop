# ADR-0013: Representative-frame temporal safety gate

- Status: Accepted
- Date: 2026-07-20
- Scope: P0-D brightness and flicker evidence

## Context

The decoded boundary gate proves whether the first and final displayed frames form a plausible seam, but it says nothing about black frames or high-amplitude brightness changes inside the clip. A clip can therefore pass the seam check while still being unsuitable for human review or stage preparation.

## Decision

`boundary-temporal-gray-v2` keeps the exact first/final 64 × 64 grayscale seam comparison and adds a bounded representative-frame pass over the full clip:

- sample at up to 12 frames per second with at most 240 representative frames;
- record the sample rate and frame count so the evidence can be reproduced;
- reject any sampled black or near-black frame under the current zero-tolerance P0-D policy;
- record maximum and 95th-percentile adjacent mean-luma changes, rejecting a maximum above 35%;
- count high-amplitude direction reversals where consecutive luma deltas are at least 18%, rejecting more than 3 reversals per second;
- expose independent seam, brightness, and flicker scores instead of collapsing them into one unexplained quality number;
- persist the complete evidence JSON and enforce its v2 shape with a database constraint;
- require v2 evidence before a validating job can advance to human review.

Sampling automatically reduces below 12 fps for long inputs so analysis remains bounded. The gate operates on decoded bytes from the immutable private asset and never trusts provider metadata or thumbnails.

## Consequences

The v2 gate catches real decoded black frames and repeated brightness reversals while remaining deterministic and inexpensive for the current 6–12 second target clips. Its thresholds are an explicit product heuristic for P0-D review; they are not a medical photosensitivity assessment or a certification that footage is safe for every audience, display, or venue. Human stage review and venue-specific checks remain required.
