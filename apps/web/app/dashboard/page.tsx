import { createDemoWorkspace } from "@droploop/pipeline";

export default async function DashboardPage() {
  const workspace = await createDemoWorkspace();
  const approved = workspace.reviewQueue.filter((review) => review.status === "approved").length;
  const avgLoop = Math.round(workspace.clips.reduce((sum, clip) => sum + clip.loopScore, 0) / workspace.clips.length);

  const metrics = [
    ["Active packs", "1"],
    ["Mock clips", String(workspace.clips.length)],
    ["Avg loop score", String(avgLoop)],
    ["Approved clips", String(approved)]
  ];

  return (
    <>
      <h1>Production Cockpit</h1>
      <p className="muted">Track structured VJ pack generation from brief to export.</p>
      <section className="grid">
        {metrics.map(([label, value]) => (
          <article className="card" key={label}>
            <div className="metric">{value}</div>
            <div className="muted">{label}</div>
          </article>
        ))}
      </section>
    </>
  );
}
