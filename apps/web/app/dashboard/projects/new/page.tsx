"use client";

import { useState } from "react";
import { AgentSidebar } from "./agent-sidebar";
import { CanvasWorkbench } from "./canvas-workbench";
import type { PipelineResponse, UploadedAsset } from "./workbench-types";

export default function NewProjectPage() {
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitProject(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    const audioFile = formData.get("audioFile");
    const referenceFiles = formData.getAll("referenceFiles").filter(isNonEmptyFile);
    if (!isNonEmptyFile(audioFile) || referenceFiles.length === 0) {
      setError("Choose one audio file and at least one visual reference.");
      setIsSubmitting(false);
      return;
    }

    formData.delete("audioFile");
    formData.delete("referenceFiles");
    const submissionId = crypto.randomUUID();
    const payload = {
      ...Object.fromEntries(formData.entries()),
      projectId: submissionId,
      idempotencyKey: submissionId
    };

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Pipeline failed with HTTP ${response.status}`);
      }

      const created = (await response.json()) as PipelineResponse;
      const assets: UploadedAsset[] = [];
      assets.push(await uploadAsset(created.project.id, audioFile, "source_audio"));
      for (const referenceFile of referenceFiles) {
        assets.push(await uploadAsset(created.project.id, referenceFile, "mood_reference"));
      }
      setResult({ ...created, assets });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown project creation error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="creationWorkbench">
      <AgentSidebar error={error} isSubmitting={isSubmitting} onSubmit={submitProject} result={result} />
      <CanvasWorkbench isSubmitting={isSubmitting} result={result} />
    </div>
  );
}

function isNonEmptyFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

async function uploadAsset(projectId: string, file: File, role: "source_audio" | "mood_reference") {
  const upload = new FormData();
  upload.set("file", file);
  upload.set("role", role);
  const response = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body: upload });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `Asset upload failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { asset: UploadedAsset };
  return body.asset;
}
