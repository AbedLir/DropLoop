"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type BpmSelectionControlsProps = {
  projectId: string;
  selectedBpm: number | null;
  selectedSource: "analysis" | "manual_override";
  analyzedBpm: number | null;
  confidence: number | null;
  analysisAssetId: string | null;
};

export function BpmSelectionControls(props: BpmSelectionControlsProps) {
  const router = useRouter();
  const [manualBpm, setManualBpm] = useState(props.selectedBpm ?? 120);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectBpm(source: "analysis" | "manual_override") {
    const selectedBpm = source === "analysis" ? Math.round(props.analyzedBpm ?? 0) : manualBpm;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${props.projectId}/bpm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedBpm,
          source,
          analysisAssetId: props.analysisAssetId ?? undefined
        })
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `BPM selection failed with HTTP ${response.status}`);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update BPM selection.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="card">
      <h2>BPM provenance</h2>
      <p className="muted">
        Selected: {props.selectedBpm ?? "unset"} BPM · {props.selectedSource.replaceAll("_", " ")}
      </p>
      {props.analyzedBpm ? (
        <p className="muted">
          Byte analysis: {props.analyzedBpm.toFixed(1)} BPM · {Math.round((props.confidence ?? 0) * 100)}% confidence
        </p>
      ) : (
        <p className="muted">No reliable analyzed tempo was found in the uploaded audio window.</p>
      )}
      <div className="bpmActions">
        <input
          aria-label="Manual BPM"
          max={240}
          min={40}
          onChange={(event) => setManualBpm(Number(event.target.value))}
          type="number"
          value={manualBpm}
        />
        <button className="button" disabled={isSaving || manualBpm < 40 || manualBpm > 240} onClick={() => selectBpm("manual_override")} type="button">
          Use manual BPM
        </button>
        {props.analyzedBpm && props.analysisAssetId ? (
          <button className="button" disabled={isSaving} onClick={() => selectBpm("analysis")} type="button">
            Use analyzed BPM
          </button>
        ) : null}
      </div>
      {error ? <p className="errorText">{error}</p> : null}
    </article>
  );
}
