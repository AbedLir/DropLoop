import Link from "next/link";
import type { PipelineResponse } from "./workbench-types";

type CanvasWorkbenchProps = {
  result: PipelineResponse | null;
  isSubmitting: boolean;
};

export function CanvasWorkbench({ result, isSubmitting }: CanvasWorkbenchProps) {
  const clips = result?.pipeline.clips ?? [];
  const assets = result?.pipeline.assetClassifications ?? [];
  const canvasNodes = result?.pipeline.canvas.nodes ?? [];

  return (
    <section className="canvasPanel">
      <div className="canvasTopbar">
        <div>
          <span className="status">Canvas Workbench</span>
          <h1>{result ? result.pipeline.brief.projectName : "AI VJ Creation Canvas"}</h1>
          <p className="muted">
            {result
              ? `${result.pipeline.brief.musicGenre} · ${result.pipeline.brief.bpm} BPM · ${result.pipeline.stagePreview.screenFormat}`
              : "Build a VJ pack from DJ set context, references, Visual DNA, loop recipes, and export constraints."}
          </p>
        </div>
        <div className="canvasActions">
          {result ? (
            <>
              <Link className="button" href={`/dashboard/projects/${result.project.id}`}>
                Open workspace
              </Link>
              <Link className="button" href={`/dashboard/projects/${result.project.id}/generation`}>
                Generation
              </Link>
              <Link className="button" href={`/dashboard/projects/${result.project.id}/export`}>
                Export pack
              </Link>
            </>
          ) : (
            <>
              <button className="button" type="button">
                Batch repair
              </button>
              <button className="button" type="button">
                Export pack
              </button>
            </>
          )}
        </div>
      </div>

      <div className="canvasBoard">
        <section className="canvasColumn wideNode">
          <h2>Production graph</h2>
          <div className="nodeGrid">
            {(canvasNodes.length ? canvasNodes : placeholderNodes).map((node) => (
              <article className="canvasNode" key={node.id}>
                <span className="status">{node.type}</span>
                <h3>{node.title}</h3>
                <p>{node.subtitle}</p>
                <p className="muted">{node.assetIds.length} linked assets</p>
              </article>
            ))}
          </div>
        </section>

        <section className="canvasColumn">
          <h2>Generated loops</h2>
          <div className="clipGrid">
            {clips.length ? (
              clips.map((clip) => (
                <article className="clipCard" key={clip.id}>
                  <div className="clipPreview">{clip.role}</div>
                  <div className="agentMessageTop">
                    <strong>{clip.clipId}</strong>
                    <span>{clip.loopScore}</span>
                  </div>
                  <p className="muted">
                    {clip.durationSeconds}s · Quality {clip.qualityScore}
                  </p>
                </article>
              ))
            ) : (
              <article className="clipCard">
                <div className="clipPreview">{isSubmitting ? "building" : "ready"}</div>
                <strong>Loop slots appear here</strong>
                <p className="muted">Styleframes, VJ loops, and thumbnails will be grouped by visual role.</p>
              </article>
            )}
          </div>
        </section>

        <section className="canvasColumn">
          <h2>Stage and export</h2>
          <article className="stagePreview">
            <div className="stageScreen">
              {result ? result.pipeline.stagePreview.surfaces.join(" / ") : "LED wall / DJ booth / client preview"}
            </div>
          </article>
          <div className="scoreRows">
            <Score label="Readability" value={result?.pipeline.stagePreview.stageReadability ?? 84} />
            <Score label="Brightness" value={result?.pipeline.stagePreview.brightnessSafety ?? 78} />
            <Score label="Contrast" value={result?.pipeline.stagePreview.contrastScore ?? 86} />
          </div>
          <article className="exportCard">
            <strong>{result?.pipeline.exportManifest.preset ?? "resolume"} export</strong>
            <p className="muted">{result?.pipeline.exportManifest.folders.join(" / ") ?? "Folder plan appears after generation."}</p>
          </article>
        </section>

        <section className="canvasColumn wideNode">
          <h2>Classified assets</h2>
          <div className="assetChipGroup">
            {(assets.length ? assets : placeholderAssets).map((asset) => (
              <span className="assetChip" key={asset.id}>
                {asset.role}
                {asset.visualRole ? ` · ${asset.visualRole}` : ""}
              </span>
            ))}
          </div>
        </section>
      </div>

      <div className="canvasToolRail">
        <button className="toolButton" title="Select nodes" type="button">
          S
        </button>
        <button className="toolButton" title="Batch action" type="button">
          B
        </button>
        <button className="toolButton" title="Export" type="button">
          E
        </button>
      </div>
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="scoreRow">
      <span>{label}</span>
      <strong>{value}</strong>
      <div className="scoreBar">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

const placeholderNodes = [
  {
    id: "brief",
    type: "brief",
    title: "VJ Pack Brief",
    subtitle: "DJ set, BPM, screen format, references",
    assetIds: []
  },
  {
    id: "recipe",
    type: "recipe",
    title: "Recipe Chain",
    subtitle: "Energy map to Visual DNA to loop pack",
    assetIds: []
  },
  {
    id: "export",
    type: "export_pack",
    title: "Export Pack",
    subtitle: "Resolume, LED wall, client review",
    assetIds: []
  }
];

const placeholderAssets = [
  { id: "audio", role: "source_audio" },
  { id: "reference", role: "mood_reference" },
  { id: "loop", role: "vj_loop", visualRole: "drop_hit" },
  { id: "manifest", role: "export_manifest" }
];
