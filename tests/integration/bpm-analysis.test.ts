import { describe, expect, it } from "vitest";
import { estimateBpmFromPcm, type BpmEstimatorConfig } from "../../apps/web/lib/media/bpm";

const testConfig: BpmEstimatorConfig = {
  sampleRate: 1_000,
  frameSize: 80,
  hopSize: 10,
  minBpm: 60,
  maxBpm: 200,
  minimumSeconds: 8,
  doubleTimeTieTolerance: 0.025,
  minimumCorrelation: 0.08
};

describe("audio BPM analysis", () => {
  it("estimates dance-tempo pulses from decoded PCM", () => {
    const result = estimateBpmFromPcm(createPulseTrack(128, 30), testConfig);

    expect(result.analyzedBpm).toBeCloseTo(128, 0);
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.algorithmVersion).toBe("onset-autocorrelation-v1");
    expect(result.beatGridAssumption).toBe("constant-tempo-double-time-tie-break");
  });

  it("returns no fabricated tempo for silent audio", () => {
    const result = estimateBpmFromPcm(new Float32Array(testConfig.sampleRate * 20), testConfig);

    expect(result.analyzedBpm).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("requires a meaningful analysis window", () => {
    const result = estimateBpmFromPcm(createPulseTrack(120, 4), testConfig);

    expect(result.analyzedBpm).toBeNull();
    expect(result.windowSeconds).toBe(4);
  });
});

function createPulseTrack(bpm: number, seconds: number): Float32Array {
  const samples = new Float32Array(testConfig.sampleRate * seconds);
  const beatInterval = (testConfig.sampleRate * 60) / bpm;
  for (let beat = 0; beat * beatInterval < samples.length; beat += 1) {
    const start = Math.round(beat * beatInterval);
    for (let offset = 0; offset < 45 && start + offset < samples.length; offset += 1) {
      samples[start + offset] = Math.exp(-offset / 9);
    }
  }
  return samples;
}
