"use client";

import { useState } from "react";
import { AgentSidebar } from "./agent-sidebar";
import { CanvasWorkbench } from "./canvas-workbench";
import type { PipelineResponse } from "./workbench-types";

export default function NewProjectPage() {
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitProject(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Pipeline failed with HTTP ${response.status}`);
      }

      setResult((await response.json()) as PipelineResponse);
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
