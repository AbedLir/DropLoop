import { execFile } from "node:child_process";

export type BpmAnalysis = {
  analyzedBpm: number | null;
  confidence: number;
  windowSeconds: number;
  sampleRate: number;
  algorithmVersion: "onset-autocorrelation-v1";
  beatGridAssumption: "constant-tempo-double-time-tie-break";
};

export type BpmEstimatorConfig = {
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  minBpm: number;
  maxBpm: number;
  minimumSeconds: number;
  doubleTimeTieTolerance: number;
  minimumCorrelation: number;
};

export const DEFAULT_BPM_ESTIMATOR_CONFIG: BpmEstimatorConfig = {
  sampleRate: 11_025,
  frameSize: 1_024,
  hopSize: 256,
  minBpm: 60,
  maxBpm: 200,
  minimumSeconds: 8,
  doubleTimeTieTolerance: 0.025,
  minimumCorrelation: 0.08
};

const ANALYSIS_WINDOW_SECONDS = 180;

export async function analyzeAudioBpm(filePath: string): Promise<BpmAnalysis> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const pcm = await decodeMonoPcm(executable, filePath, DEFAULT_BPM_ESTIMATOR_CONFIG.sampleRate);
  return estimateBpmFromPcm(pcm, DEFAULT_BPM_ESTIMATOR_CONFIG);
}

export function estimateBpmFromPcm(
  samples: Float32Array,
  config: BpmEstimatorConfig = DEFAULT_BPM_ESTIMATOR_CONFIG
): BpmAnalysis {
  const windowSeconds = samples.length / config.sampleRate;
  const empty = (): BpmAnalysis => ({
    analyzedBpm: null,
    confidence: 0,
    windowSeconds: round(windowSeconds, 3),
    sampleRate: config.sampleRate,
    algorithmVersion: "onset-autocorrelation-v1",
    beatGridAssumption: "constant-tempo-double-time-tie-break"
  });

  if (windowSeconds < config.minimumSeconds || samples.length < config.frameSize) {
    return empty();
  }

  const energy = calculateFrameEnergy(samples, config.frameSize, config.hopSize);
  const onset = calculateOnsetEnvelope(energy);
  if (onset.every((value) => value === 0)) {
    return empty();
  }

  const envelopeRate = config.sampleRate / config.hopSize;
  const minimumLag = Math.max(1, Math.floor((envelopeRate * 60) / config.maxBpm));
  const maximumLag = Math.min(onset.length - 2, Math.ceil((envelopeRate * 60) / config.minBpm));
  const candidates: Array<{ lag: number; score: number }> = [];
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    candidates.push({ lag, score: normalizedCorrelation(onset, lag) });
  }

  if (candidates.length === 0) {
    return empty();
  }

  const peak = candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
  if (peak.score < config.minimumCorrelation) {
    return empty();
  }

  const nearPeak = candidates.filter((candidate) => peak.score - candidate.score <= config.doubleTimeTieTolerance);
  const preferred = nearPeak.reduce((best, candidate) => (candidate.lag < best.lag ? candidate : best), peak);
  const refinedLag = refinePeakLag(candidates, preferred.lag);
  const analyzedBpm = (envelopeRate * 60) / refinedLag;
  const sortedScores = candidates.map((candidate) => candidate.score).sort((left, right) => left - right);
  const medianScore = sortedScores[Math.floor(sortedScores.length / 2)] ?? 0;
  const confidence = clamp(preferred.score * 0.65 + Math.max(0, preferred.score - medianScore) * 0.7, 0, 1);

  return {
    analyzedBpm: round(analyzedBpm, 1),
    confidence: round(confidence, 3),
    windowSeconds: round(windowSeconds, 3),
    sampleRate: config.sampleRate,
    algorithmVersion: "onset-autocorrelation-v1",
    beatGridAssumption: "constant-tempo-double-time-tie-break"
  };
}

function decodeMonoPcm(executable: string, filePath: string, sampleRate: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "-v",
        "error",
        "-i",
        filePath,
        "-t",
        String(ANALYSIS_WINDOW_SECONDS),
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "f32le",
        "pipe:1"
      ],
      { encoding: null, maxBuffer: 12 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Unable to decode audio for BPM analysis: ${error.message}`));
          return;
        }

        const sampleCount = Math.floor(stdout.length / Float32Array.BYTES_PER_ELEMENT);
        const samples = new Float32Array(sampleCount);
        for (let index = 0; index < sampleCount; index += 1) {
          samples[index] = stdout.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
        }
        resolve(samples);
      }
    );
  });
}

function calculateFrameEnergy(samples: Float32Array, frameSize: number, hopSize: number): Float32Array {
  const frameCount = Math.floor((samples.length - frameSize) / hopSize) + 1;
  const energy = new Float32Array(Math.max(frameCount, 0));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let sum = 0;
    for (let offset = 0; offset < frameSize; offset += 1) {
      const value = samples[start + offset] ?? 0;
      sum += value * value;
    }
    energy[frame] = Math.sqrt(sum / frameSize);
  }
  return energy;
}

function calculateOnsetEnvelope(energy: Float32Array): Float32Array {
  const onset = new Float32Array(energy.length);
  let baseline = energy[0] ?? 0;
  let maximum = 0;
  for (let index = 1; index < energy.length; index += 1) {
    const current = energy[index] ?? 0;
    baseline = baseline * 0.9 + current * 0.1;
    const value = Math.max(0, current - baseline);
    onset[index] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum <= Number.EPSILON) {
    return new Float32Array(energy.length);
  }
  for (let index = 0; index < onset.length; index += 1) {
    onset[index] = (onset[index] ?? 0) / maximum;
  }
  return onset;
}

function normalizedCorrelation(signal: Float32Array, lag: number): number {
  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = lag; index < signal.length; index += 1) {
    const left = signal[index] ?? 0;
    const right = signal[index - lag] ?? 0;
    product += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > Number.EPSILON ? product / denominator : 0;
}

function refinePeakLag(candidates: Array<{ lag: number; score: number }>, lag: number): number {
  const index = candidates.findIndex((candidate) => candidate.lag === lag);
  const left = candidates[index - 1];
  const center = candidates[index];
  const right = candidates[index + 1];
  if (!left || !center || !right) {
    return lag;
  }
  const denominator = left.score - 2 * center.score + right.score;
  if (Math.abs(denominator) <= Number.EPSILON) {
    return lag;
  }
  return lag + clamp(0.5 * (left.score - right.score) / denominator, -0.5, 0.5);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
