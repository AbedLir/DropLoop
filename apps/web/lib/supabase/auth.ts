import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../api-errors";
import { createSupabaseServerClient } from "./server";

export type AuthenticatedSupabase = {
  client: SupabaseClient;
  userId: string;
  email?: string;
};

export async function requireAuthenticatedSupabase(): Promise<AuthenticatedSupabase> {
  let client: SupabaseClient;

  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    throw new ApiError(
      503,
      error instanceof Error ? error.message : "Supabase is not configured.",
      "supabase_not_configured"
    );
  }

  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (error || !userId) {
    throw new ApiError(401, "Authentication required.", "authentication_required");
  }

  const email = typeof claims?.email === "string" ? claims.email : undefined;
  return email ? { client, userId, email } : { client, userId };
}
