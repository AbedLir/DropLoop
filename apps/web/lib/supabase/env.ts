export type SupabasePublicEnvironment = {
  url: string;
  publishableKey: string;
};

export function getSupabasePublicEnvironment(): SupabasePublicEnvironment | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function requireSupabasePublicEnvironment(): SupabasePublicEnvironment {
  const environment = getSupabasePublicEnvironment();

  if (!environment) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and a Supabase publishable key are required for authenticated DropLoop requests."
    );
  }

  return environment;
}
