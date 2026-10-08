import { z } from "zod";

/**
 * Server configuration read from the environment (.env, see .env.example).
 * Every process (web, worker, scripts) validates it once at startup so a
 * missing value fails loudly instead of surfacing later as a confusing error.
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const authModes = ["local", "intranet", "team"] as const;
export type AuthMode = (typeof authModes)[number];

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FORGECY_BASE_URL: z.url().default("http://localhost:3000"),
  FORGECY_DATA_DIR: z.string().default("./data"),
  FORGECY_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  /** Port of the worker's GET /health (Docker healthcheck, `pnpm forgecy health`). */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Chromium for site screenshots and slide export; unset uses the browser Playwright installed. */
  FORGECY_CHROMIUM_PATH: z.string().optional(),
  /** Folder of template packages to import instead of the repository's `templates`. */
  FORGECY_TEMPLATES_DIR: z.string().optional(),
  /**
   * `true` lets the crawlers read hosts on the local network (intranet audits). Off by default.
   * Stricter than `bool` on purpose: only exactly `true`, `false` or empty are accepted (case
   * sensitive, as before), so `1`, `TRUE` or `yes` fail at boot instead of silently opening or
   * closing the SSRF guard.
   */
  FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: z
    .enum(["true", "false", ""], {
      error: 'FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS must be exactly "true" or "false" (or empty)',
    })
    .optional()
    .transform((v) => v === "true"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /**
   * Optional guard for the first-run /setup page: when set, creating the first Admin needs this
   * value, so nobody who reaches a fresh instance first can claim it. Empty or unset = open (single machine).
   */
  FORGECY_SETUP_TOKEN: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .refine((v) => v === undefined || v.length >= 16, "FORGECY_SETUP_TOKEN must be at least 16 characters"),
  FORGECY_AUTH_MODE: z.enum(authModes).default("local"),
  FORGECY_ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  FORGECY_MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  /** 32-byte key (base64) used to encrypt BYOK provider keys stored in ai_connections. */
  FORGECY_ENCRYPTION_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  MEDIA_ROOT: z.string().default("./data/media"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("forgecy"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Forgecy <forgecy@localhost>"),
  SMTP_REPLY_TO: z.string().optional(),

  AI_DEFAULT_PROVIDER: z
    .enum(["anthropic", "openai", "openrouter", "deepseek", "local"])
    .default("openrouter"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  /** Image model used through OpenRouter (any model with image output on openrouter.ai/models). */
  OPENROUTER_IMAGE_MODEL: z.string().optional(),
  /**
   * Image providers in order of preference, comma separated (the first configured one is
   * primary, the next the fallback). Default: openrouter,openai,google,higgsfield (imageProviderIds in @forgecy/ai).
   */
  IMAGE_PROVIDERS: z.string().optional(),
  /**
   * Image generation through a subscription the agency already pays for, over MCP with
   * OAuth (Settings > AI providers > Connect). Higgsfield: hosted MCP server.
   */
  HIGGSFIELD_MCP_URL: z.url().default("https://mcp.higgsfield.ai/mcp"),
  /** Model passed to Higgsfield's generate_image; empty uses the server's default. */
  HIGGSFIELD_IMAGE_MODEL: z.string().optional(),
  LOCAL_LLM_ENABLED: bool,
  LOCAL_LLM_BASE_URL: z.string().default("http://localhost:11434/v1"),
  LOCAL_LLM_MODEL: z.string().optional(),

  /**
   * “Sign in with ChatGPT” (OpenAI OAuth): lets a person connect their own ChatGPT
   * account in Settings > AI providers, as an alternative to the agency's OpenAI API key.
   * OpenAI currently issues client ids only to approved partners (Settings > AI providers
   * shows this as “Awaiting OpenAI approval” until one is set). Not a secret; an Admin
   * can also set it from the interface (overrides this default), which is why it is not
   * required to be sourced only from .env like FORGECY_ENCRYPTION_KEY.
   */
  OPENAI_SIWC_CLIENT_ID: z.string().optional(),
  /** Only for a confidential OAuth client; a public client (the default) omits it. */
  OPENAI_SIWC_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function invalid(error: z.ZodError): Error {
  const issues = error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  return new Error(`Invalid Forgecy configuration:\n${issues.join("\n")}`);
}

let cached: Env | undefined;

/** Parse and cache the environment. Pass `source` in tests to avoid touching process.env. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw invalid(parsed.error);
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/**
 * The few settings crawl and render code needs. Unlike `loadEnv` it requires no database
 * or secret, so it also works in unit tests and tools, and it is not cached (it reads the
 * live environment on every call).
 */
export const toolEnvSchema = envSchema.pick({
  FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: true,
  FORGECY_CHROMIUM_PATH: true,
  FORGECY_TEMPLATES_DIR: true,
});
export type ToolEnv = z.infer<typeof toolEnvSchema>;

export function loadToolEnv(source: Record<string, string | undefined> = process.env): ToolEnv {
  const parsed = toolEnvSchema.safeParse(source);
  if (!parsed.success) throw invalid(parsed.error);
  return parsed.data;
}
