const plans = [
  { name: "Creator", packs: 4, mockCredits: 480, estimate: "$19/mo placeholder" },
  { name: "Pro VJ", packs: 16, mockCredits: 2400, estimate: "$79/mo placeholder" },
  { name: "Studio", packs: 60, mockCredits: 12000, estimate: "$249/mo placeholder" }
];

export default function BillingPage() {
  return (
    <>
      <h1>Billing</h1>
      <p className="muted">MVP pricing is a planning placeholder until real provider rendering costs are connected.</p>
      <section className="grid">
        {plans.map((plan) => (
          <article className="card" key={plan.name}>
            <h2>{plan.name}</h2>
            <div className="metric">{plan.packs}</div>
            <p className="muted">VJ packs per month</p>
            <p>{plan.mockCredits} estimated render credits</p>
            <p>{plan.estimate}</p>
          </article>
        ))}
      </section>
    </>
  );
}
