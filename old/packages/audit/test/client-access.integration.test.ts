import { PermissionDeniedError } from "@forgecy/core";
import { clients, createDb, inArray, loadClientScope, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { createQueues, type JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addFinding,
  archiveProspect,
  createProspect,
  findDuplicates,
  getProspectBySlug,
  listProspects,
  reviewFinding,
  startAudit,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl || !redisUrl)("audit: per-client access (integration)", () => {
  let db: Database;
  let queues: JobQueues;
  let f: AccessFixture;
  const tag = Math.random().toString(36).slice(2, 8);
  let hidden: { id: string; slug: string };
  let own: { id: string; slug: string };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    queues = await createQueues(redisUrl!);
    f = await createAccessFixture(db);
    hidden = await createProspect({ db }, f.admin, {
      name: `Hidden bakery ${tag}`,
      websiteUrl: `hidden-${tag}.example`,
      objectives: [],
      aiPolicy: "no_ai",
    });
  });

  afterAll(async () => {
    const ids = [hidden?.id, own?.id].filter((x): x is string => !!x);
    if (ids.length) await db.delete(clients).where(inArray(clients.id, ids));
    await f?.cleanup();
    await queues?.close();
    await db?.$client.end();
  });

  it("gives whoever creates a prospect access to it", async () => {
    own = await createProspect({ db }, f.member, {
      name: `Own bakery ${tag}`,
      objectives: [],
    });
    expect(await loadClientScope(db, f.member.id)).toContain(own.id);
  });

  it("lists, finds and opens only the prospects a person may see", async () => {
    const member = { ...f.member, clients: await loadClientScope(db, f.member.id) };
    const listed = (await listProspects(db, member, { q: tag })).map((p) => p.id);
    expect(listed).toContain(own.id);
    expect(listed).not.toContain(hidden.id);
    expect((await listProspects(db, f.nobody, { q: tag })).map((p) => p.id)).toEqual([]);
    expect((await listProspects(db, f.admin, { q: tag })).map((p) => p.id).sort()).toEqual(
      [own.id, hidden.id].sort(),
    );
    expect(await getProspectBySlug(db, member, hidden.slug)).toBeNull();
    expect((await getProspectBySlug(db, member, own.slug))?.client.id).toBe(own.id);
    // A hidden client is not revealed by the duplicate warning.
    const dupes = await findDuplicates(db, member, { websiteUrl: `https://hidden-${tag}.example` });
    expect(dupes.map((d) => d.id)).not.toContain(hidden.id);
    expect(
      (await findDuplicates(db, f.admin, { websiteUrl: `https://hidden-${tag}.example` })).map(
        (d) => d.id,
      ),
    ).toContain(hidden.id);
  });

  it("does not read or change another client's audit by id", async () => {
    const { auditId } = await startAudit({ db, queues }, f.admin, hidden.id);
    const finding = await addFinding({ db }, f.admin, {
      auditId,
      kind: "observation",
      area: "message",
      channel: "website",
      title: "Seen by the Admin",
    });
    const member = { ...f.member, clients: await loadClientScope(db, f.member.id) };
    await expect(
      reviewFinding({ db }, member, { id: finding.id, decision: "reject", rev: finding.rev }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      addFinding({ db }, member, { auditId, kind: "observation", area: "message", title: "x" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(startAudit({ db, queues }, member, hidden.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(archiveProspect({ db }, f.nobody, own.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
