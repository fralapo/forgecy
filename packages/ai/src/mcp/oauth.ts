import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ForgecyError } from "@forgecy/core";

/** What Forgecy keeps for one MCP connection; stored encrypted, never logged. */
export interface McpAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

/** Persistence of an MCP connection's OAuth state (the database in production). */
export interface McpAuthStore {
  load(): Promise<McpAuthState>;
  save(patch: Partial<McpAuthState>): Promise<void>;
  /** Remember the `state` sent to the authorization server, to match the callback. */
  saveOAuthState?(state: string): Promise<void>;
  clear(scope: "all" | "client" | "tokens" | "verifier"): Promise<void>;
}

export interface McpOAuthOptions {
  store: McpAuthStore;
  /** Forgecy's callback, e.g. https://forgecy.agency.lan/api/mcp/callback. */
  redirectUrl: string;
  clientName?: string;
}

/**
 * OAuth 2.1 client for remote MCP servers (authorization code + PKCE, dynamic client
 * registration), backed by `McpAuthStore`. The SDK's `auth()` does discovery, registration,
 * token exchange and refresh; this class only stores what it hands over and captures the
 * authorization URL so the web app can redirect the Admin's browser to it.
 */
export class StoredMcpOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  private readonly opts: McpOAuthOptions;

  constructor(opts: McpOAuthOptions) {
    this.opts = opts;
  }

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName ?? "Forgecy",
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.opts.store.saveOAuthState?.(state);
    return state;
  }

  async clientInformation() {
    return (await this.opts.store.load()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.opts.store.save({ clientInformation });
  }

  async tokens() {
    return (await this.opts.store.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.opts.store.save({ tokens, codeVerifier: undefined });
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.opts.store.save({ codeVerifier });
  }

  async codeVerifier() {
    const v = (await this.opts.store.load()).codeVerifier;
    if (!v) throw new ForgecyError("validation", "No pending MCP authorization");
    return v;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope !== "discovery") await this.opts.store.clear(scope);
  }
}

export type StartAuthResult = { status: "authorized" } | { status: "redirect"; url: string };

/** Begin (or silently refresh) the authorization of an MCP server. */
export async function startMcpAuthorization(
  provider: StoredMcpOAuthProvider,
  serverUrl: string,
  fetchFn?: typeof fetch,
): Promise<StartAuthResult> {
  const result = await auth(provider, { serverUrl, ...(fetchFn ? { fetchFn } : {}) });
  if (result === "AUTHORIZED") return { status: "authorized" };
  if (!provider.authorizationUrl)
    throw new ForgecyError("provider_error", "The MCP server did not return an authorization URL");
  return { status: "redirect", url: provider.authorizationUrl.toString() };
}

/** Exchange the code the authorization server sent to the callback for tokens. */
export async function finishMcpAuthorization(
  provider: StoredMcpOAuthProvider,
  serverUrl: string,
  authorizationCode: string,
  fetchFn?: typeof fetch,
): Promise<void> {
  const result = await auth(provider, {
    serverUrl,
    authorizationCode,
    ...(fetchFn ? { fetchFn } : {}),
  });
  if (result !== "AUTHORIZED")
    throw new ForgecyError("provider_error", "The MCP server did not issue tokens");
}
