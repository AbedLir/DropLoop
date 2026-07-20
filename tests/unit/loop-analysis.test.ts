import {
  evaluateLoopBoundary,
  evaluateLoopSafety,
  type LoopAnalysisPolicy,
  type LoopSafetyPolicy
} from "@droploop/media";
import { describe, expect, it } from "vitest";

const policy: LoopAnalysisPolicy = {
  algorithmVersion: "test-boundary-v1",
  frameWidth: 2,
  frameHeight: 2,
  maxBoundaryMaePercent: 12,
  maxBrightnessJumpPercent: 8,
  blackFrameLumaFloorPercent: 2
};

const safetyPolicy: LoopSafetyPolicy = {
  ...policy,
  algorithmVersion: "test-temporal-v2",
  sampleFramesPerSecond: 12,
  maxRepresentativeFrames: 24,
  maxBlackFrameRatioPercent: 0,
  maxAdjacentBrightnessJumpPercent: 35,
  flashBrightnessDeltaPercent: 18,
  maxFlashReversalsPerSecond: 3
};

describe("decoded loop boundary analysis", () => {
  it("passes a visually continuous non-black boundary", () => {
    const result = evaluateLoopBoundary(
      new Uint8Array([100, 110, 120, 130]),
      new Uint8Array([102, 108, 123, 127]),
      policy
    );

    expect(result).toMatchObject({
      algorithmVersion: "test-boundary-v1",
      decision: "pass",
      firstFrameBlack: false,
      lastFrameBlack: false,
      reasons: []
    });
    expect(result.boundaryMaePercent).toBeLessThan(2);
  });

  it("requires repair when the seam changes brightness or reaches black", () => {
    const result = evaluateLoopBoundary(
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([255, 255, 255, 255]),
      policy
    );

    expect(result.decision).toBe("repair_required");
    expect(result.loopScore).toBe(0);
    expect(result.firstFrameBlack).toBe(true);
    expect(result.reasons).toEqual([
      "Boundary MAE 100% exceeds 12%.",
      "Boundary brightness jump 100% exceeds 8%.",
      "First decoded frame is black or near-black."
    ]);
  });

  it("rejects malformed decoded frame evidence", () => {
    expect(() => evaluateLoopBoundary(new Uint8Array([1]), new Uint8Array([1]), policy)).toThrow(
      "must each contain 4 grayscale pixels"
    );
  });
});

describe("representative-frame temporal safety", () => {
  it("passes a stable non-black sample and preserves separate safety scores", () => {
    const frames = [100, 104, 108, 105, 102, 100].map((value) => new Uint8Array(4).fill(value));
    const result = evaluateLoopSafety(frames[0]!, frames.at(-1)!, frames, 2, 3, safetyPolicy);

    expect(result).toMatchObject({
      algorithmVersion: "test-temporal-v2",
      decision: "pass",
      sampledFrameCount: 6,
      blackFrameCount: 0,
      flashReversalCount: 0,
      reasons: []
    });
    expect(result.brightnessSafetyScore).toBeGreaterThan(95);
    expect(result.flickerSafetyScore).toBe(100);
  });

  it("flags representative black frames, severe brightness steps, and rapid reversals", () => {
    const frames = Array.from({ length: 24 }, (_, index) => new Uint8Array(4).fill(index % 2 === 0 ? 0 : 255));
    const result = evaluateLoopSafety(frames[0]!, frames.at(-1)!, frames, 2, 12, safetyPolicy);

    expect(result.decision).toBe("repair_required");
    expect(result.blackFrameRatioPercent).toBe(50);
    expect(result.maxAdjacentBrightnessJumpPercent).toBe(100);
    expect(result.flashReversalsPerSecond).toBeGreaterThan(3);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Representative black-frame ratio"),
      expect.stringContaining("Maximum sampled brightness jump"),
      expect.stringContaining("Rapid brightness reversals")
    ]));
  });
});
