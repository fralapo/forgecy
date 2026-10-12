export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante: controlla .env.local");
  return { url, key };
}
export const configuredAI = () => Boolean(process.env.OPENROUTER_API_KEY);
