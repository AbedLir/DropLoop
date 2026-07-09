import { createDemoWorkspace } from "@droploop/pipeline";

export default async function StagePreviewPage() {
  const workspace = await createDemoWorkspace();

  return (
    <>
      <h1>Stage Preview</h1>
      <section className="card">
        <div className="stagePreview">
          <div className="stageScreen">{workspace.stagePreview.surfaces.join(" / ")}</div>
        </div>
        <section className="grid" style={{ marginTop: 18 }}>
          <article>
            <h2>{workspace.stagePreview.stageReadability}</h2>
            <p className="muted">Stage readability</p>
          </article>
          <article>
            <h2>{workspace.stagePreview.brightnessSafety}</h2>
            <p className="muted">Brightness safety</p>
          </article>
          <article>
            <h2>{workspace.stagePreview.contrastScore}</h2>
            <p className="muted">Contrast score</p>
          </article>
        </section>
      </section>
    </>
  );
}
