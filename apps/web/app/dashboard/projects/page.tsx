import { createDemoWorkspace } from "@droploop/pipeline";
import Link from "next/link";

export default async function ProjectsPage() {
  const workspace = await createDemoWorkspace();

  return (
    <>
      <h1>Projects</h1>
      <section className="grid">
        <article className="card">
          <span className="status">reviewing</span>
          <h2>{workspace.brief.projectName}</h2>
          <p className="muted">
            {workspace.brief.musicGenre} · {workspace.brief.bpm} BPM · {workspace.clips.length} mock clips
          </p>
          <Link className="button" href="/dashboard/projects/demo">
            Open project
          </Link>
        </article>
      </section>
    </>
  );
}
