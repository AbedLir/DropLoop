import { buildExportPresetDetail, createDemoWorkspace } from "@droploop/pipeline";

const presets = ["resolume", "madmapper", "touchdesigner", "led_wall", "social", "client_review"] as const;

export default async function ExportPage() {
  const workspace = await createDemoWorkspace();

  return (
    <>
      <h1>Export Presets</h1>
      <section className="grid">
        {presets.map((preset) => {
          const detail = buildExportPresetDetail(preset);

          return (
            <article className="card" key={preset}>
              <h2>{detail.label}</h2>
              <p className="muted">{workspace.exportManifest.approvedClipIds.length} approved clips</p>
              <p>{detail.folders.join(" / ")}</p>
              <p className="muted">{detail.playback.codecTarget} · {detail.playback.resolution} · alpha {detail.playback.alphaSupport}</p>
              <p>{detail.handoffNotes.join(" ")}</p>
            </article>
          );
        })}
      </section>
    </>
  );
}
