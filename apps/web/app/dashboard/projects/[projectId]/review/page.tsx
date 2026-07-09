"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ReviewItem = {
  clipId: string;
  status: string;
  recommendedAction: string;
  reason: string;
};

type ReviewPayload = {
  reviews: ReviewItem[];
  clips: Array<{
    id: string;
    clipId: string;
    role: string;
    loopScore: number;
    qualityScore: number;
  }>;
};

export default function ReviewPage() {
  const params = useParams<{ projectId: string }>();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [clips, setClips] = useState<ReviewPayload["clips"]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      try {
        const response = await fetch(`/api/projects/${params.projectId}/review`);
        if (!response.ok) {
          throw new Error(`Review queue failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as ReviewPayload;
        if (!cancelled) {
          setReviews(payload.reviews);
          setClips(payload.clips);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown review queue error");
        }
      }
    }

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, [params.projectId]);

  async function applyAction(clipId: string, action: "approve" | "reject" | "repair" | "regenerate") {
    const response = await fetch(`/api/projects/${params.projectId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId, action })
    });
    const result = (await response.json()) as { clipId: string; status: string; action: string; reason: string };

    setReviews((current) =>
      current.map((review) =>
        review.clipId === result.clipId
          ? { ...review, status: result.status, recommendedAction: result.action, reason: result.reason }
          : review
      )
    );
  }

  return (
    <>
      <h1>Human Review</h1>
      {error ? <p className="errorText">{error}</p> : null}
      <section className="grid">
        {reviews.map((review) => {
          const clip = clips.find((item) => item.id === review.clipId);

          return (
            <article className="card" key={review.clipId}>
              <span className="status">{review.status}</span>
              <h2>{clip?.clipId ?? review.clipId}</h2>
              <p className="muted">
                {clip?.role ?? "clip"} · Loop {clip?.loopScore ?? 0} · Quality {clip?.qualityScore ?? 0}
              </p>
              <p>{review.reason}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {(["approve", "reject", "repair", "regenerate"] as const).map((action) => (
                  <button className="button" key={action} onClick={() => void applyAction(review.clipId, action)} type="button">
                    {action}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
