import Link from "next/link";
import { signIn, signUp } from "../auth/actions";

const messages: Record<string, string> = {
  invalid_credentials: "Enter a valid email and a password with at least 8 characters.",
  sign_in_failed: "Sign in failed. Check your credentials and Supabase Auth configuration.",
  sign_up_failed: "Account creation failed. Check the Supabase Auth logs for details.",
  supabase_not_configured: "Supabase is not configured for this deployment."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const query = await searchParams;
  const errorMessage = query.error ? messages[query.error] ?? "Authentication failed." : null;

  return (
    <main className="main authPage">
      <section className="authCard">
        <Link className="brand" href="/">
          DROPLOOP
        </Link>
        <p className="status">Authenticated production cockpit</p>
        <h1>Sign in</h1>
        <p className="muted">Your projects, clips, reviews, and repair jobs are isolated by Supabase RLS.</p>
        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        {query.message === "check_email" ? (
          <p className="successText">Account created. Check your email if confirmation is enabled.</p>
        ) : null}
        <form className="authForm">
          <input name="next" type="hidden" value={query.next ?? "/dashboard"} />
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" minLength={8} name="password" required type="password" />
          </label>
          <div className="authActions">
            <button className="button primaryButton" formAction={signIn} type="submit">
              Sign in
            </button>
            <button className="button" formAction={signUp} type="submit">
              Create account
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
