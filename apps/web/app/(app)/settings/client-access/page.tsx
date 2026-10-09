import { asc, clients, eq, getDb, listClientAccess, users } from "@forgecy/db";
import { Badge, Card, cn } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { AccessToggle } from "./access-toggle";

export async function generateMetadata() {
  const t = await getTranslations("admin.clientAccess");
  return { title: t("title") };
}

/**
 * Which clients each person can open (ADR 0020). Admins see every client and are not
 * listed; a person without clients sees none until an Admin assigns some here.
 */
export default async function ClientAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const user = await requireUser();
  const t = await getTranslations("admin.clientAccess");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const db = getDb();
  const [people, clientRows, assignments] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.isAdmin, false))
      .orderBy(asc(users.name)),
    db
      .select({
        id: clients.id,
        name: clients.name,
        status: clients.status,
        archivedAt: clients.archivedAt,
      })
      .from(clients)
      .orderBy(asc(clients.name)),
    listClientAccess(db, user.actor),
  ]);
  const sp = await searchParams;
  const selected = people.find((p) => p.id === sp.user) ?? people[0] ?? null;
  const count = new Map<string, number>();
  for (const a of assignments) count.set(a.userId, (count.get(a.userId) ?? 0) + 1);
  const granted = new Set(
    assignments.filter((a) => a.userId === selected?.id).map((a) => a.clientId),
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <p className="mb-6 text-body-sm text-fg-muted">{t("adminNote")}</p>
      {people.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("noPeople")}</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <Card className="p-0">
            <h2 className="border-b border-subtle px-4 py-3 text-label text-fg-muted">
              {t("people")}
            </h2>
            <ul>
              {people.map((p) => (
                <li key={p.id} className="border-b border-subtle last:border-0">
                  <Link
                    href={`/settings/client-access?user=${p.id}` as Route}
                    aria-current={p.id === selected?.id ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 px-4 py-3 text-body-sm",
                      p.id === selected?.id ? "bg-app text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    <span>
                      {p.name}
                      <span className="block text-fg-muted">{p.email}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {p.active ? null : <Badge>{t("inactive")}</Badge>}
                      <Badge>{t("clientCount", { count: count.get(p.id) ?? 0 })}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {selected ? (
            <Card className="p-6">
              <h2 className="text-heading-sm text-fg">
                {t("clientsFor", { name: selected.name })}
              </h2>
              {clientRows.length === 0 ? (
                <p className="mt-4 text-body-md text-fg-muted">{t("noClients")}</p>
              ) : (
                <fieldset className="mt-4 flex flex-col gap-3">
                  <legend className="sr-only">{t("clientsFor", { name: selected.name })}</legend>
                  {clientRows.map((c) => (
                    <AccessToggle
                      key={`${selected.id}:${c.id}`}
                      userId={selected.id}
                      clientId={c.id}
                      granted={granted.has(c.id)}
                      label={
                        c.archivedAt
                          ? t("archivedClient", { name: c.name })
                          : c.status === "prospect"
                            ? t("prospectClient", { name: c.name })
                            : c.name
                      }
                    />
                  ))}
                </fieldset>
              )}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
