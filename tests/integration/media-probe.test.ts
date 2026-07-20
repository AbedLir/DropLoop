import { describe, expect, it } from "vitest";
import { MediaProbeError, parseProbeOutput } from "../../apps/web/lib/media/ffprobe";

describe("ffprobe media normalization", () => {
  it("derives audio duration and codec from probe output", () => {
    const result = parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: "audio", codec_name: "mp3", duration: "61.234" }],
        format: { format_name: "mp3", duration: "61.234" }
      }),
      "audio"
    );

    expect(result).toMatchObject({
      kind: "audio",
      codec: "mp3",
      durationSeconds: 61.234,
      width: null,
      hasAlpha: null
    });
  });

  it("normalizes video dimensions, fractional frame rate, pixel format, and alpha", () => {
    const result = parseProbeOutput(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "prores",
            width: 1920,
            height: 1080,
            pix_fmt: "yuva444p10le",
            avg_frame_rate: "30000/1001"
          },
          { codec_type: "audio", codec_name: "aac" }
        ],
        format: { format_name: "mov,mp4", duration: "8.0" }
      }),
      "video"
    );

    expect(result.codec).toBe("prores");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.frameRate).toBeCloseTo(29.97, 2);
    expect(result.pixelFormat).toBe("yuva444p10le");
    expect(result.hasAlpha).toBe(true);
    expect(result.audioCodec).toBe("aac");
  });

  it("accepts a decodable still image without fabricated duration", () => {
    const result = parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "png", width: 1200, height: 800, pix_fmt: "rgba" }],
        format: { format_name: "image2" }
      }),
      "image"
    );

    expect(result).toMatchObject({
      codec: "png",
      durationSeconds: null,
      width: 1200,
      height: 800,
      hasAlpha: true
    });
  });

  it("rejects MIME claims that do not contain the required media stream", () => {
    expect(() =>
      parseProbeOutput(
        JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
          format: { duration: "8" }
        }),
        "audio"
      )
    ).toThrow(MediaProbeError);
  });
});
