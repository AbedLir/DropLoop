"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicEnvironment } from "./env";

export function createSupabaseBrowserClient() {
  const environment = requireSupabasePublicEnvironment();
  return createBrowserClient(environment.url, environment.publishableKey);
}
