import "server-only";
import { getDb, schema } from "@forgecy/db";
import { isLocale, negotiateLocale } from "@forgecy/i18n";
import { createMailer, renderMagicLinkEmail } from "@forgecy/mail";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { env } from "./env";
import { loginGuard } from "./login-guard";
import { PASSWORD_MAX, PASSWORD_MIN } from "./password";

const db = getDb();
const teamMode = env.FORGECY_AUTH_MODE === "team";
const googleEnabled = teamMode && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/** Magic link and Google identities are admitted only in team mode and only for allowed domains. */
function isAllowedDomain(email: string | undefined): boolean {
  const domain = email?.split("@")[1]?.toLowerCase() ?? "";
  return teamMode && env.FORGECY_ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/** The raw (not yet validated) email/username of a sign-in body; anything that is not a string counts as empty. */
function typedIdentifier(body: unknown): string {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : "";
}

export const auth = betterAuth({
  appName: "Forgecy",
  baseURL: env.FORGECY_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FORGECY_BASE_URL, ...env.ALLOWED_ORIGINS],
  telemetry: { enabled: false },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env.FORGECY_BASE_URL.startsWith("https://"),
  },
  user: {
    // Setup and Admin write users directly (lib/users.ts); every identity Better Auth provisions is gated.
    validateUserInfo: ({ user, source }) => {
      if (source.method === "email-password" && source.action === "sign-in") return;
      if (!isAllowedDomain(typeof user.email === "string" ? user.email : undefined)) {
        return {
          error: "domain_not_allowed",
          errorDescription: "This address is not allowed to sign in to Forgecy.",
        };
      }
    },
    additionalFields: {
      isAdmin: { type: "boolean", defaultValue: false, input: false },
      isProductOwner: { type: "boolean", defaultValue: false, input: false },
      active: { type: "boolean", defaultValue: true, input: false },
      locale: { type: "string", required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Accounts are created by the first-run setup or by an Admin, never by self sign-up.
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  // ponytail: in-memory per-IP buckets (reset on restart); per-username lockout is in hooks below. Move to storage: "database" if running several web replicas.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/magic-link": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, session.userId),
          });
          if (!user?.active) throw new APIError("FORBIDDEN", { message: "Account deactivated." });
          return { data: session };
        },
      },
    },
  },
  hooks: {
    // Same answer for known and unknown usernames: the throttle only sees the typed identifier.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      // Take the ticket before any password is checked: a burst of concurrent requests cannot all pass.
      const wait = await loginGuard.attempt(typedIdentifier(ctx.body));
      if (wait > 0)
        throw new APIError(
          "TOO_MANY_REQUESTS",
          { message: "Too many attempts. Try again later." },
          { "Retry-After": String(wait) },
        );
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const id = typedIdentifier(ctx.body);
      const returned: unknown = ctx.context.returned;
      if (!isAPIError(returned)) await loginGuard.succeeded(id);
      // A wrong password (401) keeps its ticket; any other error never reached the password check
      // (e.g. a malformed body), so it must not count against the person.
      else if (returned.statusCode !== 401) await loginGuard.refund(id);
    }),
  },
  plugins: [
    ...(teamMode
      ? [
          magicLink({
            expiresIn: env.FORGECY_MAGIC_LINK_TTL_MINUTES * 60,
            storeToken: "hashed",
            disableSignUp: env.FORGECY_ALLOWED_EMAIL_DOMAINS.length === 0,
            sendMagicLink: async ({ email, url }, ctx) => {
              // The person's saved language, otherwise the language of the browser asking.
              const user = await db.query.users.findFirst({
                where: (u, { eq }) => eq(u.email, email.toLowerCase()),
                columns: { locale: true },
              });
              const message = await renderMagicLinkEmail({
                url,
                minutes: env.FORGECY_MAGIC_LINK_TTL_MINUTES,
                appName: "Forgecy",
                locale: isLocale(user?.locale)
                  ? user.locale
                  : negotiateLocale(ctx?.request?.headers.get("accept-language")),
              });
              await createMailer(env).sendMail({ to: email, ...message });
            },
          }),
        ]
      : []),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
