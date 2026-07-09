import { createDemoWorkspace } from "@droploop/pipeline";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const workspace = await createDemoWorkspace();
  const { projectId } = await params;

  return (
    <>
      <h1>Project {projectId}</h1>
      <p className="muted">{workspace.brief.outputGoal}</p>

      <section className="timeline">
        {workspace.stageResults.map((stage) => (
          <article className="timelineItem" key={stage.stage}>
            <span className="status">{stage.status}</span>
            <h3>{stage.stage.replaceAll("_", " ")}</h3>
            <p className="muted">{stage.progress}%</p>
          </article>
        ))}
      </section>

      <section className="grid" style={{ marginTop: 18 }}>
        <article className="card">
          <h2>Visual DNA</h2>
          <p>{workspace.visualDna.lockedTraits.join(" / ")}</p>
          <p className="muted">{workspace.visualDna.flexibleTraits.join(" / ")}</p>
        </article>
        <article className="card">
          <h2>Energy map</h2>
          {workspace.energyMap.sections.map((section) => (
            <p key={section.id}>
              {section.section} · {section.energy} · {section.visualRole}
            </p>
          ))}
        </article>
      </section>
    </>
  );
}
