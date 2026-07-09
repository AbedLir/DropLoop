import { createDemoWorkspace } from "@droploop/pipeline";

export default async function GenerationPage() {
  const workspace = await createDemoWorkspace();

  return (
    <>
      <h1>Generation Board</h1>
      <section className="grid">
        {workspace.clips.map((clip) => {
          const prompt = workspace.prompts.find((item) => item.clipId === clip.clipId);

          return (
            <article className="card" key={clip.id}>
              <span className="status">{clip.status}</span>
              <h2>{clip.clipId}</h2>
              <p className="muted">
                Role: {clip.role} · Energy {prompt?.energy ?? 0} · MockProvider
              </p>
              <div className="metric">{clip.loopScore}</div>
              <p>{prompt?.positivePrompt}</p>
            </article>
          );
        })}
      </section>
    </>
  );
}
