import Link from "next/link";
import { SupabaseProjectStore } from "../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../lib/supabase/auth";

export default async function ProjectsPage() {
  const { client } = await requireAuthenticatedSupabase();
  const projects = await new SupabaseProjectStore(client).listProjects();

  return (
    <>
      <div className="pageHeading">
        <div>
          <h1>Projects</h1>
          <p className="muted">Only projects owned by the authenticated user are returned by RLS.</p>
        </div>
        <Link className="button primaryButton" href="/dashboard/projects/new">
          New project
        </Link>
      </div>
      {projects.length === 0 ? (
        <section className="card emptyState">
          <h2>No persisted projects yet</h2>
          <p className="muted">Create the first VJ pack to verify project, clip, and review persistence.</p>
        </section>
      ) : (
        <section className="grid">
          {projects.map((project) => (
            <article className="card" key={project.id}>
              <span className="status">{project.status}</span>
              <h2>{project.name}</h2>
              <p className="muted">
                {project.musicGenre ?? "Unclassified"} · {project.bpm ?? "Manual BPM"} · {project.packSize} clips
              </p>
              <Link className="button" href={`/dashboard/projects/${project.id}`}>
                Open project
              </Link>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
