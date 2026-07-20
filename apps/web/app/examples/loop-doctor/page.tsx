import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LoopSafetyAnalysisResult, MediaProbe } from "@droploop/media";
import Link from "next/link";
import { LoopDoctorAcceptance } from "./loop-doctor-acceptance";

export const dynamic = "force-dynamic";

export type AcceptanceFixture = {
  generatedAt: string;
  analyzerVersion: string;
  repairVersion: string;
  sourceSha256: string;
  repairedSha256: string;
  sourceProbe: MediaProbe;
  repairedProbe: MediaProbe;
  before: LoopSafetyAnalysisResult;
  after: LoopSafetyAnalysisResult;
  caveat: string;
};

export default async function LoopDoctorAcceptancePage() {
  const fixture = await loadFixture();

  return (
    <main className="loopDoctorPage">
      <nav className="loopDoctorNav">
        <Link className="loopDoctorBrand" href="/">DROPLOOP</Link>
        <Link className="button" href="/examples">Back to examples</Link>
      </nav>
      {fixture ? (
        <LoopDoctorAcceptance fixture={fixture} />
      ) : (
        <section className="loopDoctorMissing card">
          <span className="status statusWarning">Fixture required</span>
          <h1>Prepare the real Loop Doctor acceptance sample</h1>
          <p className="muted">
            Run <code>pnpm --filter @droploop/worker prepare:loop-doctor-preview</code>, then refresh this page.
            The command generates and analyzes local video bytes; it makes no Seedance or Kling request.
          </p>
        </section>
      )}
    </main>
  );
}

async function loadFixture(): Promise<AcceptanceFixture | null> {
  try {
    const path = resolve(process.cwd(), "public/acceptance/loop-doctor/evidence.json");
    const candidate = JSON.parse(await readFile(path, "utf8")) as AcceptanceFixture;
    if (
      candidate.before?.decision !== "repair_required" ||
      candidate.after?.decision !== "pass" ||
      candidate.analyzerVersion !== candidate.after.algorithmVersion ||
      typeof candidate.repairVersion !== "string"
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}
