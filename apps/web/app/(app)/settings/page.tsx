import { Badge, Card } from "@forgecy/ui";
import { asc, getDb, users } from "@forgecy/db";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { NewUserForm } from "./new-user-form";
import { WorkerCheck } from "./worker-check";

export const metadata = { title: "Settings" };

const authModeLabel = {
  local: "Local",
  intranet: "Intranet",
  team: "Team (magic link and Google)",
} as const;

export default async function SettingsPage() {
  const user = await requireUser();
  const people = user.isAdmin ? await getDb().select().from(users).orderBy(asc(users.name)) : [];
  // Only whether a key is configured, never the key itself.
  const providers = [
    { name: "Anthropic", ready: Boolean(env.ANTHROPIC_API_KEY) },
    { name: "OpenAI", ready: Boolean(env.OPENAI_API_KEY) },
    { name: "OpenRouter", ready: Boolean(env.OPENROUTER_API_KEY) },
    { name: "Google (images)", ready: Boolean(env.GOOGLE_AI_API_KEY) },
    { name: "Local model", ready: env.LOCAL_LLM_ENABLED },
  ];

  return (
    <>
      <PageHeader title="Settings" description="Access, agency people and AI providers." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">Instance</h2>
          <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-body-sm">
            <dt className="text-fg-muted">Access</dt>
            <dd className="text-fg">{authModeLabel[env.FORGECY_AUTH_MODE]}</dd>
            <dt className="text-fg-muted">File storage</dt>
            <dd className="text-fg">
              {env.STORAGE_DRIVER === "local" ? "Local disk" : "S3-compatible"}
            </dd>
            <dt className="text-fg-muted">Default AI provider</dt>
            <dd className="font-mono text-fg">{env.AI_DEFAULT_PROVIDER}</dd>
          </dl>
          {user.isAdmin ? <WorkerCheck /> : null}
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">AI providers</h2>
          <p className="mt-2 text-body-sm text-fg-muted">
            Keys are set in the server’s .env file. The only costs are the providers’ API charges.
          </p>
          <ul className="mt-4 space-y-2">
            {providers.map((p) => (
              <li key={p.name} className="flex items-center justify-between text-body-sm">
                <span className="text-fg">{p.name}</span>
                <Badge variant={p.ready ? "success" : "neutral"}>
                  {p.ready ? "Configured" : "Not configured"}
                </Badge>
              </li>
            ))}
          </ul>
          {user.isAdmin ? (
            <Link
              href="/settings/ai-providers"
              className="mt-4 inline-block text-body-sm text-link underline"
            >
              Commercial use of images
            </Link>
          ) : null}
        </Card>
        {user.isAdmin ? (
          <>
            <Card className="p-6">
              <h2 className="text-heading-sm text-fg">People</h2>
              <ul className="mt-4 divide-y divide-subtle">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-body-sm">
                    <span>
                      <span className="block text-fg">{p.name}</span>
                      <span className="text-fg-muted">{p.email}</span>
                    </span>
                    <span className="flex gap-2">
                      {p.isAdmin ? <Badge>Admin</Badge> : null}
                      {!p.active ? <Badge variant="warning">Deactivated</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-6">
              <h2 className="text-heading-sm text-fg">Add a person</h2>
              <NewUserForm />
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
