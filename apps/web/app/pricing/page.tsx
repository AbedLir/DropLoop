export default function PricingPage() {
  return (
    <main className="main">
      <h1>Pricing</h1>
      <section className="grid">
        {["Creator", "Pro VJ", "Studio"].map((plan) => (
          <article className="card" key={plan}>
            <h2>{plan}</h2>
            <p className="muted">Draft, select, and final render economy tiers.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
