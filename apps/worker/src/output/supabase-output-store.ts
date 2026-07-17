import { createClient } from "@supabase/supabase-js";
import type { OutputObjectStore } from "./provider-output-processor";

export class SupabaseOutputObjectStore implements OutputObjectStore {
  private readonly client;

  constructor(url = requireEnvironment("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY")) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }

  async uploadImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<"created" | "exists"> {
    const { error } = await this.client.storage.from("project-assets").upload(path, bytes, {
      contentType,
      upsert: false
    });
    if (!error) {
      return "created";
    }
    const status = "statusCode" in error ? Number(error.statusCode) : Number.NaN;
    if (status === 409 || /already exists|duplicate/i.test(error.message)) {
      return "exists";
    }
    throw error;
  }

  async download(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from("project-assets").download(path);
    if (error) throw error;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("Stored provider output is empty.");
    return bytes;
  }
}

function requireEnvironment(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required for private provider output storage.`);
}
