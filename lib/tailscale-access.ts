export type TailscaleAccess =
  | { allowed: true; mode: "loopback" | "tailscale" }
  | { allowed: false; status: 401 | 403; error: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function authorizeRequestHost(input: {
  hostname: string;
  tailscaleLogin?: string | null;
  allowedTailscaleUser?: string | null;
  allowedTailscaleHost?: string | null;
}): TailscaleAccess {
  const hostname = input.hostname.trim().toLowerCase().replace(/\.$/, "");
  const requester = input.tailscaleLogin?.trim().toLowerCase();
  const allowedHost = input.allowedTailscaleHost?.trim().toLowerCase().replace(/\.$/, "");
  if (LOOPBACK_HOSTS.has(hostname)) {
    if (!requester) return { allowed: true, mode: "loopback" };
    const allowedUser = input.allowedTailscaleUser?.trim().toLowerCase();
    if (!allowedUser || requester !== allowedUser || !allowedHost || !allowedHost.endsWith(".ts.net"))
      return { allowed: false, status: 403, error: "Questo account Tailscale non è autorizzato a usare Forgecy." };
    return { allowed: true, mode: "tailscale" };
  }
  if (!hostname.endsWith(".ts.net"))
    return { allowed: false, status: 403, error: "Forgecy non è disponibile su questo host." };

  const allowedUser = input.allowedTailscaleUser?.trim().toLowerCase();
  if (!allowedHost || !allowedHost.endsWith(".ts.net") || hostname !== allowedHost)
    return { allowed: false, status: 403, error: "Host Tailscale non configurato per Forgecy." };
  if (!allowedUser)
    return { allowed: false, status: 403, error: "Accesso Tailscale non configurato su questo computer." };
  if (!requester)
    return { allowed: false, status: 401, error: "Accedi a Forgecy tramite Tailscale Serve." };
  if (requester !== allowedUser)
    return { allowed: false, status: 403, error: "Questo account Tailscale non è autorizzato a usare Forgecy." };
  return { allowed: true, mode: "tailscale" };
}

export function validateTailscaleOrigin(origin: string | null, hostname?: string): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || !parsed.hostname.toLowerCase().endsWith(".ts.net") ||
      (hostname && !LOOPBACK_HOSTS.has(hostname.toLowerCase()) && parsed.hostname.toLowerCase() !== hostname.toLowerCase()) ||
      parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || origin !== parsed.origin) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
