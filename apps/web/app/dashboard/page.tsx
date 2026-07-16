import { SupabaseProjectStore } from "../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../lib/supabase/auth";

export default async function DashboardPage() {
  const { client } = await requireAuthenticatedSupabase();
  const projects = await new SupabaseProjectStore(client).listProjects();
  const metrics = [
    ["Persisted projects", String(projects.length)],
    ["In generation", String(projects.filter((project) => project.status === "generating").length)],
    ["Awaiting review", String(projects.filter((project) => project.status === "reviewing").length)],
    ["Exported packs", String(projects.filter((project) => project.status === "exported").length)]
  ];

  return (
    <>
      <h1>Production Cockpit</h1>
      <p className="muted">Authenticated project state backed by Supabase Postgres and owner-only RLS.</p>
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
