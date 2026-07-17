import { evaluateLoopBoundary, type LoopAnalysisPolicy } from "@droploop/media";
import { describe, expect, it } from "vitest";

const policy: LoopAnalysisPolicy = {
  algorithmVersion: "test-boundary-v1",
  frameWidth: 2,
  frameHeight: 2,
  maxBoundaryMaePercent: 12,
  maxBrightnessJumpPercent: 8,
  blackFrameLumaFloorPercent: 2
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
