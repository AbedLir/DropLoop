export default function ExamplesPage() {
  return (
    <main className="main">
      <h1>Example Packs</h1>
      <section className="grid">
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
