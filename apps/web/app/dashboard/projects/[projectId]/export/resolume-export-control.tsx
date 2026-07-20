"use client";

import { useState } from "react";

type ApprovedClip = {
  id: string;
  planned_clip_id: string;
  role: string;
  duration_seconds: number | null;
};

type ResolumeDelivery = {
  id: string;
  jobId: string | null;
  clipId: string | null;
  status: "queued" | "exporting" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  media: {
    filename: string;
    hasAlpha: boolean;
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
  } | null;
};

type ExportPayload = {
  approvedClips: ApprovedClip[];
  exports: ResolumeDelivery[];
};

export function ResolumeExportControl({
  projectId,
  initialApprovedClips,
  initialExports
}: {
  projectId: string;
  initialApprovedClips: ApprovedClip[];
  initialExports: ResolumeDelivery[];
}) {
  const [approvedClips, setApprovedClips] = useState(initialApprovedClips);
  const [deliveries, setDeliveries] = useState(initialExports);
  const [requestingClipId, setRequestingClipId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/export`, { cache: "no-store" });
      const payload = (await response.json()) as ExportPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Delivery status failed with HTTP ${response.status}`);
      }
      setApprovedClips(payload.approvedClips);
      setDeliveries(payload.exports);
      setNotice("Delivery status refreshed from the durable project record.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh delivery status.");
    } finally {
      setRefreshing(false);
    }
  }

  async function requestDelivery(clip: ApprovedClip) {
    setRequestingClipId(clip.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: "resolume", clipId: clip.id, idempotencyKey: crypto.randomUUID() })
      });
      const result = (await response.json()) as {
        exportId?: string;
        jobId?: string;
        status?: ResolumeDelivery["status"];
        createdAt?: string;
        acceptance?: string;
        error?: string;
      };
      if (!response.ok || !result.exportId || !result.jobId || !result.status || !result.createdAt) {
        throw new Error(result.error ?? `Unable to queue delivery with HTTP ${response.status}`);
      }
      const created: ResolumeDelivery = {
        id: result.exportId,
        jobId: result.jobId,
        clipId: clip.id,
        status: result.status,
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        media: null
      };
      setDeliveries((current) => [created, ...current.filter((delivery) => delivery.id !== created.id)]);
      setNotice(result.acceptance ?? "Resolume delivery queued. Refresh when the worker has processed the job.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to queue the Resolume delivery.");
    } finally {
      setRequestingClipId(null);
    }
  }

  return (
    <section className="resolumeDelivery" aria-labelledby="resolume-delivery-title">
      <div className="resolumeDeliveryIntro">
        <div>
          <span className="status">private delivery</span>
          <h1 id="resolume-delivery-title">Resolume delivery</h1>
          <p className="muted">
            Queue one approved clip at a time. The worker fixes its immutable source and v3 seam evidence before writing a private ProRes MOV.
          </p>
        </div>
        <button className="button" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>

      <div aria-live="polite" className="resolumeDeliveryMessage">
        {error ? <p className="errorText">{error}</p> : null}
        {!error && notice ? <p className="successText">{notice}</p> : null}
      </div>

      <section className="resolumeDeliverySection" aria-labelledby="queue-title">
        <div className="resolumeSectionHeading">
          <div>
            <span className="resolumeEyebrow">Step 1</span>
            <h2 id="queue-title">Choose an approved clip</h2>
          </div>
          <p className="muted">The request rejects stale evidence, substituted assets, or any clip without a human approval.</p>
        </div>

        {approvedClips.length === 0 ? (
          <div className="resolumeEmptyState">
            <strong>No approved clips are ready to export.</strong>
            <p>Complete Human Review first. Approval and the current v3 loop evidence remain separate gates.</p>
          </div>
        ) : (
          <div className="resolumeClipList">
            {approvedClips.map((clip) => {
              const inFlight = deliveries.some(
                (delivery) => delivery.clipId === clip.id && (delivery.status === "queued" || delivery.status === "exporting")
              );
              const isRequesting = requestingClipId === clip.id;
              return (
                <article className="resolumeClip" key={clip.id}>
                  <div>
                    <span className="status">approved</span>
                    <h3>{clip.planned_clip_id}</h3>
                    <p className="muted">
                      {clip.role.replaceAll("_", " ")}
                      {clip.duration_seconds ? ` · ${clip.duration_seconds}s` : ""}
                    </p>
                  </div>
                  <button
                    className="button primaryButton"
                    type="button"
                    onClick={() => void requestDelivery(clip)}
                    disabled={isRequesting || inFlight}
                  >
                    {isRequesting ? "Queueing…" : inFlight ? "Delivery in progress" : "Queue ProRes delivery"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="resolumeDeliverySection" aria-labelledby="delivery-title">
        <div className="resolumeSectionHeading">
          <div>
            <span className="resolumeEyebrow">Step 2</span>
            <h2 id="delivery-title">Private delivery records</h2>
          </div>
          <p className="muted">A download appears only after the durable job has stored and verified both the MOV and manifest.</p>
        </div>

        {deliveries.length === 0 ? (
          <div className="resolumeEmptyState">
            <strong>No delivery requests yet.</strong>
            <p>Queued and completed deliveries remain tied to their exact source asset and loop evidence.</p>
          </div>
        ) : (
          <div className="resolumeDeliveryList">
            {deliveries.map((delivery) => (
              <article className="resolumeDeliveryRecord" key={delivery.id}>
                <div className="resolumeRecordHeading">
                  <div>
                    <span className={statusClassName(delivery.status)}>{delivery.status.replaceAll("_", " ")}</span>
                    <h3>{clipLabel(delivery, approvedClips)}</h3>
                  </div>
                  <time dateTime={delivery.updatedAt}>{formatTimestamp(delivery.updatedAt)}</time>
                </div>
                {delivery.media ? (
                  <p className="muted">
                    {delivery.media.filename} · {delivery.media.width}×{delivery.media.height} · {delivery.media.frameRate} fps · {delivery.media.durationSeconds}s ·{" "}
                    {delivery.media.hasAlpha ? "verified alpha" : "opaque"}
                  </p>
                ) : (
                  <p className="muted">No media is available until the worker completes the private delivery record.</p>
                )}
                {delivery.status === "completed" && delivery.media ? (
                  <div className="resolumeDownloadActions">
                    <a className="button primaryButton" href={`/api/projects/${projectId}/exports/${delivery.id}/media`}>
                      Download MOV
                    </a>
                    <a className="button" href={`/api/projects/${projectId}/exports/${delivery.id}/manifest`}>
                      Download manifest
                    </a>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="resolumeManualGate" aria-labelledby="manual-gate-title">
        <div>
          <span className="resolumeEyebrow">Manual gate</span>
          <h2 id="manual-gate-title">Still required before show use</h2>
        </div>
        <ul>
          <li>Import the downloaded MOV into the target Resolume Deck.</li>
          <li>Run a representative loop for 10 minutes on target hardware.</li>
          <li>Record black-frame, seam, brightness, and Alpha observations separately from this machine record.</li>
        </ul>
        <p>DXV3 is not included or implied by this ProRes delivery.</p>
      </aside>
    </section>
  );
}

function clipLabel(delivery: ResolumeDelivery, clips: ApprovedClip[]): string {
  return clips.find((clip) => clip.id === delivery.clipId)?.planned_clip_id ?? "Immutable clip delivery";
}

function statusClassName(status: ResolumeDelivery["status"]): string {
  if (status === "completed") return "status";
  if (status === "failed" || status === "cancelled") return "status statusDanger";
  return "status statusWarning";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : date.toLocaleString();
}
