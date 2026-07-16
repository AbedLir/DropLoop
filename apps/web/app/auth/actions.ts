"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200)
});

export async function signIn(formData: FormData) {
  const nextPath = safeNextPath(formData.get("next"));
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    redirect(`/login?error=invalid_credentials&next=${encodeURIComponent(nextPath)}`);
  }

  let client;
  try {
    client = await createSupabaseServerClient();
  } catch {
    redirect("/login?error=supabase_not_configured");
  }

  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error) {
    redirect(`/login?error=sign_in_failed&next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}

export async function signUp(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    redirect("/login?error=invalid_credentials");
  }

  let client;
  try {
    client = await createSupabaseServerClient();
  } catch {
    redirect("/login?error=supabase_not_configured");
  }

  const { error } = await client.auth.signUp(parsed.data);
  if (error) {
    redirect("/login?error=sign_up_failed");
  }

  redirect("/login?message=check_email");
}

export async function signOut() {
  try {
    const client = await createSupabaseServerClient();
    await client.auth.signOut();
  } finally {
    redirect("/login");
  }
}

function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/dashboard") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}
