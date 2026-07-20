import Link from "next/link";

export default function ExamplesPage() {
  return (
    <main className="main">
      <h1>Example Packs</h1>
      <section className="grid">
        <article className="card">
          <span className="status">Acceptance ready</span>
          <h2>Loop Doctor · P0-D</h2>
          <p className="muted">Real decoded before/after evidence with synchronized visual review controls.</p>
          <Link className="button primaryButton" href="/examples/loop-doctor">Open acceptance preview</Link>
        </article>
        {["Dark Melodic Techno", "Festival Drop Pack", "Brand Event Identity"].map((pack) => (
          <article className="card" key={pack}>
            <h2>{pack}</h2>
            <p className="muted">Mock VJ pack concept with DNA, energy map, loop scores, and export plan.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
