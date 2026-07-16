import { execFile } from "node:child_process";

export type MediaKind = "audio" | "image" | "video";

export type MediaProbe = {
  kind: MediaKind;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codec: string;
  pixelFormat: string | null;
  hasAlpha: boolean | null;
  formatName: string | null;
  audioCodec: string | null;
  videoCodec: string | null;
};

type ProbeStream = {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  pix_fmt?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
  duration?: unknown;
};

type ProbeDocument = {
  streams?: unknown;
  format?: {
    format_name?: unknown;
    duration?: unknown;
  };
};

export class MediaProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProbeError";
  }
}

export async function probeMediaFile(filePath: string, expectedKind: MediaKind): Promise<MediaProbe> {
  const executable = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const output = await runProbe(executable, [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,duration",
    "-of",
    "json",
    filePath
  ]);

  return parseProbeOutput(output, expectedKind);
}

export function parseProbeOutput(output: string, expectedKind: MediaKind): MediaProbe {
  let document: ProbeDocument;
  try {
    document = JSON.parse(output) as ProbeDocument;
  } catch {
    throw new MediaProbeError("ffprobe returned invalid JSON.");
  }

  const streams = Array.isArray(document.streams) ? (document.streams as ProbeStream[]) : [];
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const durationSeconds = positiveNumber(document.format?.duration) ?? positiveNumber(audioStream?.duration) ?? positiveNumber(videoStream?.duration);
  const width = positiveInteger(videoStream?.width);
  const height = positiveInteger(videoStream?.height);
  const frameRate = positiveRate(videoStream?.avg_frame_rate) ?? positiveRate(videoStream?.r_frame_rate);
  const audioCodec = nonEmptyString(audioStream?.codec_name);
  const videoCodec = nonEmptyString(videoStream?.codec_name);
  const pixelFormat = nonEmptyString(videoStream?.pix_fmt);

  if (expectedKind === "audio" && (!audioCodec || !durationSeconds)) {
    throw new MediaProbeError("The uploaded audio must contain a decodable audio stream with duration.");
  }

  if (expectedKind === "image" && (!videoCodec || !width || !height)) {
    throw new MediaProbeError("The uploaded image must contain a decodable visual stream with dimensions.");
  }

  if (expectedKind === "video" && (!videoCodec || !durationSeconds || !width || !height || !frameRate)) {
    throw new MediaProbeError("The uploaded video must contain duration, dimensions, codec, and frame rate.");
  }

  return {
    kind: expectedKind,
    durationSeconds,
    width,
    height,
    frameRate,
    codec: expectedKind === "audio" ? (audioCodec as string) : (videoCodec as string),
    pixelFormat,
    hasAlpha: expectedKind === "audio" ? null : hasAlphaChannel(pixelFormat),
    formatName: nonEmptyString(document.format?.format_name),
    audioCodec,
    videoCodec
  };
}

function runProbe(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 20_000 }, (error, stdout) => {
      if (error) {
        reject(new MediaProbeError(`Unable to inspect uploaded media: ${error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function positiveRate(value: unknown): number | null {
  if (typeof value === "number") {
    return positiveNumber(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  const rate = denominator === 0 ? Number.NaN : numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasAlphaChannel(pixelFormat: string | null): boolean {
  if (!pixelFormat) {
    return false;
  }
  return /^(?:rgba|bgra|argb|abgr|ya\d*|yuva|gbrap)/i.test(pixelFormat);
}
