import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SupabaseProjectStore } from "../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../lib/supabase/auth";
import { BpmSelectionControls } from "./bpm-selection-controls";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) {
    notFound();
  }

  const { client } = await requireAuthenticatedSupabase();
  const detail = await new SupabaseProjectStore(client).getProject(projectId);
  if (!detail) {
    notFound();
  }

  return (
    <>
      <div className="pageHeading">
        <div>
          <span className="status">{detail.project.status}</span>
          <h1>{detail.project.name}</h1>
          <p className="muted">
            {detail.project.musicGenre ?? "Unclassified"} · {detail.project.bpm ?? "Manual BPM"} BPM ·{" "}
            {detail.project.screenFormat}
          </p>
        </div>
        <Link className="button primaryButton" href={`/dashboard/projects/${projectId}/review`}>
          Open human review
        </Link>
      </div>

      <section className="grid">
        <BpmSelectionControls
          analysisAssetId={detail.bpmAnalysis.analysisAssetId}
          analyzedBpm={detail.bpmAnalysis.analyzedBpm}
          confidence={detail.bpmAnalysis.confidence}
          projectId={projectId}
          selectedBpm={detail.bpmAnalysis.selectedBpm}
          selectedSource={detail.bpmAnalysis.selectedSource}
        />
        <article className="card">
          <h2>Real source assets</h2>
          <div className="metric">{detail.assets.length}</div>
          <p className="muted">Private bytes inspected with ffprobe and registered as immutable asset versions.</p>
        </article>
        <article className="card">
          <h2>Persisted clips</h2>
          <div className="metric">{detail.clips.length}</div>
          <p className="muted">Relational clip records survive refreshes and worker restarts.</p>
        </article>
        <article className="card">
          <h2>Durable jobs</h2>
          <div className="metric">{detail.jobs.length}</div>
          <p className="muted">Repair and regenerate review actions create claimable jobs.</p>
        </article>
      </section>

      {detail.assets.length > 0 ? (
        <section className="timeline" style={{ marginTop: 18 }}>
          {detail.assets.map((asset) => (
            <article className="timelineItem" key={asset.id}>
              <span className="status">{asset.role.replaceAll("_", " ")}</span>
              <h3>{asset.filename}</h3>
              <p className="muted">
                {asset.codec}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                {asset.duration_seconds ? ` · ${asset.duration_seconds.toFixed(2)}s` : ""}
                {asset.frame_rate ? ` · ${asset.frame_rate.toFixed(2)} fps` : ""}
                {asset.bpm_analyzed ? ` · ${asset.bpm_analyzed.toFixed(1)} BPM (${Math.round((asset.bpm_confidence ?? 0) * 100)}%)` : ""}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="timeline" style={{ marginTop: 18 }}>
        {detail.jobs.length === 0 ? (
          <article className="timelineItem">
            <span className="status">ready</span>
            <h3>No repair jobs requested</h3>
            <p className="muted">Use Human Review to approve, reject, repair, or regenerate a clip.</p>
          </article>
        ) : (
          detail.jobs.map((job) => (
            <article className="timelineItem" key={job.id}>
              <span className="status">{job.status}</span>
              <h3>{job.stage.replaceAll("_", " ")}</h3>
              <p className="muted">
                {job.operation} · {job.progress}%
              </p>
            </article>
          ))
        )}
      </section>
    </>
  );
}
