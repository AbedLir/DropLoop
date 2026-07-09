import { buildExportPresetDetail } from "@droploop/pipeline";
import { describe, expect, it } from "vitest";

describe("buildExportPresetDetail", () => {
  it.each(["resolume", "madmapper", "touchdesigner", "led_wall", "social", "client_review"] as const)(
    "builds required export detail for %s",
    (preset) => {
      const detail = buildExportPresetDetail(preset);

      expect(detail.preset).toBe(preset);
      expect(detail.folders.length).toBeGreaterThan(0);
      expect(detail.requiredFiles).toContain("manifest.json");
      expect(detail.requiredFiles).toContain("safety-report.json");
      expect(detail.playback.codecTarget).toBeTruthy();
      expect(detail.handoffNotes.length).toBeGreaterThan(0);
    }
  );
});
