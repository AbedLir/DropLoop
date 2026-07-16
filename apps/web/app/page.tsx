import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="main">
      <section style={{ maxWidth: 980 }}>
        <p className="status">AI VJ Pack Builder</p>
        <h1 style={{ fontSize: 64, lineHeight: 1, margin: "22px 0" }}>DROPLOOP</h1>
        <p className="muted" style={{ fontSize: 22, maxWidth: 720 }}>
          Turn tracks, moods, and references into stage-ready VJ packs.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
          <Link className="button" href="/login">
            Sign in to cockpit
          </Link>
          <Link className="button" href="/examples">
            View examples
          </Link>
        </div>
      </section>
    </main>
  );
}
