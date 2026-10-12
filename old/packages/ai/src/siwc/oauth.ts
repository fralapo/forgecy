import { createHash, randomBytes } from "node:crypto";
import { ForgecyError } from "@forgecy/core";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * “Sign in with ChatGPT” (SIWC): OpenAI's own OAuth 2.0 / OpenID Connect endpoints,
 * found at developers.openai.com/siwc (2026-10-07). There is no dynamic client
 * registration endpoint: OpenAI currently hands out a client id by hand, only to
 * approved partners (developers.openai.com/siwc/request-client-id) — until Forgecy
 * has one, `OPENAI_SIWC_CLIENT_ID` stays unset and Settings > AI providers shows
 * “Awaiting OpenAI approval” instead of a Connect button.
 */
export const SIWC_ISSUER = "https://auth.openai.com";
export const SIWC_AUTHORIZATION_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";
export const SIWC_TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token";
export const SIWC_REVOKE_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/revoke";
export const SIWC_JWKS_URI = "https://auth.openai.com/.well-known/jwks.json";

/**
 * Identity scopes only: `openid profile email` for the signed ID token (name, email,
 * picture), `offline_access` for a refresh token. ChatGPT plan usage (spending the
 * person's Plus/Pro quota instead of the agency's API key) needs a second, separate
 * authorization that OpenAI has not published a scope or endpoint for yet (SIWC's own
 * docs: “ChatGPT plan usage in open-source apps has a separate authorization and
 * registration flow”) — so Forgecy does not request it and never claims to have it.
 */
export const SIWC_SCOPE = "openid profile email offline_access";

export interface SiwcTokens {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  /** Unix seconds; always set (OpenAI's access tokens are short-lived). */
  expiresAt: number;
}

export interface SiwcProfile {
  /** OpenAI's stable account identifier (the ID token's `sub`). */
  subject: string;
  name?: string;
  email?: string;
  picture?: string;
}

export interface SiwcClientConfig {
  clientId: string;
  /** Only for a confidential client; a public client (the default, PKCE-only) omits it. */
  clientSecret?: string;
  redirectUri: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/** PKCE pair (RFC 7636, S256 — the only method OpenAI's discovery document advertises). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function buildAuthorizationUrl(
  client: Pick<SiwcClientConfig, "clientId" | "redirectUri">,
  opts: { state: string; codeChallenge: string },
): string {
  const url = new URL(SIWC_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SIWC_SCOPE);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
  error_description?: string;
}

async function postToken(
  client: SiwcClientConfig,
  body: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<SiwcTokens> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const params = new URLSearchParams({ client_id: client.clientId, ...body });
  if (client.clientSecret) {
    headers.Authorization = basicAuthHeader(client.clientId, client.clientSecret);
  }
  let res: Response;
  try {
    res = await fetchFn(SIWC_TOKEN_ENDPOINT, { method: "POST", headers, body: params });
  } catch (err) {
    throw new ForgecyError("provider_error", "Could not reach OpenAI's token endpoint", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token || !data.id_token) {
    throw new ForgecyError(
      "provider_error",
      `OpenAI refused the token request: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

/** Authorization-code exchange with the PKCE verifier; the last step of the connect flow. */
export async function exchangeSiwcCode(
  client: SiwcClientConfig,
  code: string,
  codeVerifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<SiwcTokens> {
  return postToken(
    client,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      code_verifier: codeVerifier,
    },
    fetchFn,
  );
}

/** Refresh, using the `offline_access` refresh token. OpenAI may rotate it; always save the new one. */
export async function refreshSiwcTokens(
  client: SiwcClientConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<SiwcTokens> {
  return postToken(client, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchFn);
}

/** Best-effort: OpenAI's revocation endpoint (RFC 7009). Disconnecting never depends on this succeeding. */
export async function revokeSiwcToken(
  client: SiwcClientConfig,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (client.clientSecret)
    headers.Authorization = basicAuthHeader(client.clientId, client.clientSecret);
  const params = new URLSearchParams({ client_id: client.clientId, token });
  await fetchFn(SIWC_REVOKE_ENDPOINT, { method: "POST", headers, body: params }).catch(
    () => undefined,
  );
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function siwcJwks() {
  jwks ??= createRemoteJWKSet(new URL(SIWC_JWKS_URI));
  return jwks;
}

/** Verifies the ID token's signature, issuer, audience and expiry, then reads its claims. */
export async function verifySiwcIdToken(idToken: string, clientId: string): Promise<SiwcProfile> {
  const { payload } = await jwtVerify(idToken, siwcJwks(), {
    issuer: SIWC_ISSUER,
    audience: clientId,
  });
  if (typeof payload.sub !== "string")
    throw new ForgecyError("provider_error", "OpenAI's ID token has no subject claim");
  return {
    subject: payload.sub,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}
