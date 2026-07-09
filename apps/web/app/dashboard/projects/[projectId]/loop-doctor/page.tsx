import { createDemoWorkspace } from "@droploop/pipeline";

export default async function LoopDoctorPage() {
  const workspace = await createDemoWorkspace();

  return (
    <>
      <h1>Loop Doctor</h1>
      <section className="grid">
        {workspace.clips.map((clip) => {
          const quality = workspace.qualityScores[clip.id];

          return (
            <article className="card" key={clip.id}>
              <span className="status">{quality?.decision ?? "missing"}</span>
              <h2>{clip.clipId}</h2>
              <p>Loop continuity: {quality?.loopContinuity ?? 0}</p>
              <p>Motion stability: {quality?.motionStability ?? 0}</p>
              <p>Brightness safety: {quality?.brightnessSafety ?? 0}</p>
            </article>
          );
        })}
      </section>
    </>
  );
}
