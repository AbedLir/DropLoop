import type { AgentMessage, PipelineResponse } from "./workbench-types";

const starterMessages: AgentMessage[] = [
  {
    id: "welcome",
    role: "agent",
    title: "DROPLOOP Agent",
    body: "Tell me the DJ set, BPM, venue screen, mood, and references. I will turn them into a stage-ready VJ pack.",
    bullets: ["No faces or readable text by default", "Loop-first prompts", "Export-ready folder plan"],
    status: "idle"
  },
  {
    id: "vj-brief",
    role: "system",
    title: "VJ pack brief",
    body: "Default setup: warehouse techno, 132 BPM, club LED wall, industrial red haze.",
    bullets: ["Energy map", "Visual DNA", "Loop pack", "Stage preview"],
    status: "idle"
  }
];

const promptChips = [
  "@motif steel tunnel",
  "@camera slow push",
  "@energy drop",
  "@screen LED wall",
  "@role stinger",
  "@alpha none"
];

type AgentSidebarProps = {
  result: PipelineResponse | null;
  error: string | null;
  isSubmitting: boolean;
  onSubmit: (formData: FormData) => void;
};

export function AgentSidebar({ result, error, isSubmitting, onSubmit }: AgentSidebarProps) {
  const messages = result ? result.pipeline.agentEvents : starterMessages;
  const recipes = result?.pipeline.recipes ?? [];

  return (
    <aside className="agentPanel">
      <div className="agentHeader">
        <span className="status">VJ Agent</span>
        <strong>{result ? result.pipeline.brief.projectName : "New VJ Pack"}</strong>
      </div>

      <div className="agentScroll">
        {messages.map((message) => (
          <article className="agentMessage" key={message.id}>
            <div className="agentMessageTop">
              <strong>{message.title}</strong>
              <span>{message.status ?? "idle"}</span>
            </div>
            <p>{message.body}</p>
            {message.bullets?.length ? (
              <ul>
                {message.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}

        <section className="promptChipGroup">
          {promptChips.map((chip) => (
            <button className="promptChip" key={chip} type="button">
              {chip}
            </button>
          ))}
        </section>

        {recipes.length > 0 ? (
          <section className="recipeStack">
            {recipes.map((recipe) => (
              <article className="recipeCard" key={recipe.id}>
                <div className="agentMessageTop">
                  <strong>{recipe.label}</strong>
                  <span className="status">{recipe.status}</span>
                </div>
                <p>{recipe.summary}</p>
                <p className="muted">
                  {recipe.inputRoles.join(" to ")} to {recipe.outputRoles.join(" + ")}
                </p>
              </article>
            ))}
          </section>
        ) : null}
      </div>

      <form className="agentComposer" action={onSubmit}>
        <input name="projectName" required defaultValue="Warehouse Techno Night" />
        <div className="composerGrid">
          <input name="musicGenre" required defaultValue="warehouse techno" />
          <input name="bpm" required type="number" min={40} max={240} defaultValue={132} />
        </div>
        <div className="composerGrid">
          <select name="template" defaultValue="club_night">
            <option value="club_night">Club Night</option>
            <option value="festival_mainstage">Festival Mainstage</option>
            <option value="touring_dj_support">Touring DJ Support</option>
            <option value="brand_launch">Brand Launch</option>
            <option value="client_preview">Client Preview</option>
            <option value="dj_booth_strip">DJ Booth Strip</option>
          </select>
          <select name="screenFormat" defaultValue="16:9">
            <option value="16:9">16:9</option>
            <option value="21:9">21:9</option>
            <option value="32:9">32:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </div>
        <select name="packSize" defaultValue={12}>
          <option value={12}>12 clips</option>
          <option value={30}>30 clips</option>
          <option value={60}>60 clips</option>
        </select>
        <input name="showType" required defaultValue="club LED wall" />
        <textarea name="desiredMood" required rows={3} defaultValue="industrial strobes, steel tunnels, red haze" />
        <textarea name="references" rows={3} defaultValue={"red haze moodboard\nwide LED wall\nDJ booth strip"} />
        <label className="uploadField">
          <span>Source audio · one file</span>
          <input
            accept="audio/flac,audio/mp4,audio/mpeg,audio/wav,audio/x-wav"
            name="audioFile"
            required
            type="file"
          />
        </label>
        <label className="uploadField">
          <span>Visual references · one or more</span>
          <input
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
            multiple
            name="referenceFiles"
            required
            type="file"
          />
        </label>
        {result?.assets?.length ? (
          <p className="successText">
            {result.assets.length} private source assets uploaded and inspected from real bytes.
          </p>
        ) : null}
        {error ? <p className="errorText">{error}</p> : null}
        <button className="button primaryButton" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Agent is building..." : "Generate VJ pack"}
        </button>
      </form>
    </aside>
  );
}
