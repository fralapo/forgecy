import { auditJobStates, getProspectBySlug } from "@forgecy/audit";
import { Badge } from "@forgecy/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { JobWatch } from "../_components/job-watch";
import { SectionTabs } from "../_components/section-tabs";
import { auditStatusLabel, auditStatusVariant, jobLabel } from "../_lib/labels";
import { readDeps } from "../_lib/server";

export default async function ProspectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { db } = readDeps();
  const prospect = await getProspectBySlug(db, slug);
  if (!prospect) notFound();
  const { client, audit } = prospect;
  const jobs = audit ? await auditJobStates(db, audit.id) : [];
  return (
    <>
      <Link
        href="/audit"
        className="mb-4 inline-flex items-center gap-1 text-body-sm text-link underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All prospects
      </Link>
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-heading-lg text-fg">{client.name}</h1>
        {audit ? (
          <Badge variant={auditStatusVariant[audit.status]}>{auditStatusLabel[audit.status]}</Badge>
        ) : null}
        {client.archivedAt ? <Badge>Prospect archived</Badge> : null}
      </header>
      {audit ? <SectionTabs slug={slug} /> : null}
      {jobs.length ? (
        <div className="mb-6">
          <JobWatch
            jobs={jobs.map((j) => ({
              id: j.id,
              kind: j.kind,
              label: jobLabel[j.kind] ?? j.kind,
              status: j.status,
              progress: j.progress,
              error: j.error,
            }))}
          />
        </div>
      ) : null}
      {children}
    </>
  );
}
