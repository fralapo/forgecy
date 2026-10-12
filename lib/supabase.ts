import { createServerClient } from "@supabase/ssr";
import { createBrowserClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export async function serverDb() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(entries) {
        try { entries.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Components cannot set cookies; proxy refreshes sessions. */ }
      }
    }
  });
}
export function browserDb() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
