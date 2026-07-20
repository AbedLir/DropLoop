"use client";

import { useRef, useState } from "react";
import type { LoopSafetyAnalysisResult } from "@droploop/media";
import type { AcceptanceFixture } from "./page";

const checks = [
  "The repaired seam feels continuous at the loop point",
  "No objectionable brightness pulse is visible",
  "The repair keeps the intended motion and composition"
] as const;

export function LoopDoctorAcceptance({ fixture }: { fixture: AcceptanceFixture }) {
  const beforeVideo = useRef<HTMLVideoElement>(null);
  const afterVideo = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [accepted, setAccepted] = useState<boolean[]>(checks.map(() => false));
  const allAccepted = accepted.every(Boolean);

  async function togglePlayback() {
    const videos = [beforeVideo.current, afterVideo.current].filter((video): video is HTMLVideoElement => Boolean(video));
    if (playing) {
      videos.forEach((video) => video.pause());
      setPlaying(false);
      return;
    }
    await Promise.all(videos.map((video) => video.play()));
    setPlaying(true);
  }

  async function inspectSeam() {
    const videos = [beforeVideo.current, afterVideo.current].filter((video): video is HTMLVideoElement => Boolean(video));
    videos.forEach((video) => {
      video.currentTime = Math.max(0, video.duration - 0.7);
      video.playbackRate = 0.5;
    });
    await Promise.all(videos.map((video) => video.play()));
    setPlaying(true);
  }

  function resetPlaybackRate() {
    [beforeVideo.current, afterVideo.current].forEach((video) => {
      if (video) video.playbackRate = 1;
    });
  }

  return (
    <>
      <header className="loopDoctorHero">
        <div>
          <span className="loopDoctorEyebrow">P0-D · Human acceptance checkpoint</span>
          <h1>Can Loop Doctor remove the seam without damaging the clip?</h1>
          <p>
            Both panels play the same immutable source lineage. “After” is the zero-cost local cyclic crossfade,
            followed by a fresh decoded v3 seam-window analysis.
          </p>
        </div>
        <div className="loopDoctorDecision">
          <span>Machine gate</span>
          <strong>{fixture.before.decision} → {fixture.after.decision}</strong>
          <small>{fixture.analyzerVersion}</small>
        </div>
      </header>

      <section className="loopDoctorToolbar" aria-label="Playback controls">
        <button className="button primaryButton" onClick={() => void togglePlayback()} type="button">
          {playing ? "Pause both" : "Play both"}
        </button>
        <button className="button" onClick={() => void inspectSeam()} type="button">Inspect seam at 0.5×</button>
        <button className="button" onClick={resetPlaybackRate} type="button">Reset to 1×</button>
        <span className="muted">Muted · synchronized controls · videos loop independently</span>
      </section>

      <section className="loopDoctorCompare">
        <VideoEvidence
          analysis={fixture.before}
          label="Before · immutable source"
          ref={beforeVideo}
          src="/acceptance/loop-doctor/before.mp4"
        />
        <VideoEvidence
          analysis={fixture.after}
          label="After · repaired candidate"
          ref={afterVideo}
          src="/acceptance/loop-doctor/after.mp4"
        />
      </section>

      <section className="loopDoctorEvidence card">
        <div>
          <span className="loopDoctorEyebrow">Decoded evidence</span>
          <h2>Machine-verifiable change</h2>
        </div>
        <div className="loopDoctorEvidenceGrid">
          <DeltaMetric label="Seam MAE" before={fixture.before.boundaryMaePercent} after={fixture.after.boundaryMaePercent} suffix="%" />
          <DeltaMetric label="Motion ratio" before={fixture.before.seamTransitionOutlierRatio} after={fixture.after.seamTransitionOutlierRatio} suffix="×" />
          <DeltaMetric label="Jerk ratio" before={fixture.before.seamJerkOutlierRatio} after={fixture.after.seamJerkOutlierRatio} suffix="×" />
          <DeltaMetric label="Seam score" before={fixture.before.seamContinuityScore} after={fixture.after.seamContinuityScore} />
          <DeltaMetric label="Brightness score" before={fixture.before.brightnessSafetyScore} after={fixture.after.brightnessSafetyScore} />
        </div>
        <details>
          <summary>Evidence lineage and thresholds</summary>
          <dl className="loopDoctorLineage">
            <div><dt>Source SHA-256</dt><dd>{shortHash(fixture.sourceSha256)}</dd></div>
            <div><dt>Repaired SHA-256</dt><dd>{shortHash(fixture.repairedSha256)}</dd></div>
            <div><dt>Repair</dt><dd>{fixture.repairVersion}</dd></div>
            <div><dt>Samples</dt><dd>{fixture.after.sampledFrameCount} @ {fixture.after.sampleFramesPerSecond} fps</dd></div>
            <div><dt>Seam window</dt><dd>{fixture.after.seamWindowFrameCount} frames per side</dd></div>
            <div><dt>Motion threshold</dt><dd>{fixture.after.policy.maxSeamTransitionOutlierRatio}× max</dd></div>
            <div><dt>Jerk threshold</dt><dd>{fixture.after.policy.maxSeamJerkOutlierRatio}× max</dd></div>
            <div><dt>Max luma step</dt><dd>{fixture.after.policy.maxAdjacentBrightnessJumpPercent}%</dd></div>
            <div><dt>Flash reversals</dt><dd>{fixture.after.policy.maxFlashReversalsPerSecond}/s max</dd></div>
          </dl>
        </details>
      </section>

      <section className="loopDoctorAcceptance card">
        <div>
          <span className="loopDoctorEyebrow">Your visual review</span>
          <h2>Acceptance checklist</h2>
          <p className="muted">This local state is not written to the project database.</p>
        </div>
        <div className="loopDoctorChecklist">
          {checks.map((check, index) => (
            <label key={check}>
              <input
                checked={accepted[index]}
                onChange={(event) => setAccepted((current) => current.map((value, itemIndex) =>
                  itemIndex === index ? event.target.checked : value
                ))}
                type="checkbox"
              />
              <span>{check}</span>
            </label>
          ))}
        </div>
        <div className={allAccepted ? "loopDoctorHumanDecision accepted" : "loopDoctorHumanDecision"}>
          {allAccepted ? "Ready for your approval" : "Waiting for visual checks"}
        </div>
      </section>

      <p className="loopDoctorCaveat">{fixture.caveat}</p>
    </>
  );
}

function VideoEvidence({
  analysis,
  label,
  ref,
  src
}: {
  analysis: LoopSafetyAnalysisResult;
  label: string;
  ref: React.RefObject<HTMLVideoElement | null>;
  src: string;
}) {
  const passing = analysis.decision === "pass";
  return (
    <article className="loopDoctorVideoCard">
      <div className="loopDoctorVideoHeader">
        <div>
          <span className="loopDoctorEyebrow">{label}</span>
          <h2>{passing ? "Gate passed" : "Repair required"}</h2>
        </div>
        <span className={passing ? "status" : "status statusDanger"}>{analysis.decision}</span>
      </div>
      <video autoPlay loop muted playsInline preload="auto" ref={ref} src={src} />
      <div className="loopDoctorMiniMetrics">
        <Metric label="Seam" value={analysis.seamContinuityScore} />
        <Metric label="Brightness" value={analysis.brightnessSafetyScore} />
        <Metric label="Flicker" value={analysis.flickerSafetyScore} />
      </div>
      {analysis.reasons.length > 0 ? (
        <ul className="loopDoctorReasons">
          {analysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : <p className="successText">All decoded v3 seam-window checks passed.</p>}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DeltaMetric({ label, before, after, suffix = "" }: { label: string; before: number; after: number; suffix?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{before}{suffix} <small>→</small> {after}{suffix}</strong>
    </div>
  );
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}
