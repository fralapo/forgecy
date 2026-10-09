import { isSensitiveMemoryCategory, type Actor } from "@forgecy/core";
import {
  clients,
  createDb,
  eq,
  jobsLog,
  memoryItems,
  memoryItemVersions,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMemory,
  approvedMemoriesFor,
  approveMemories,
  approveMemory,
  archiveMemory,
  editMemory,
  getMemory,
  listMemories,
  loadClientMemorySettings,
  memoryCounts,
  promoteMemory,
  rejectMemory,
  saveClientMemorySetting,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** Seeds what an agent proposal used to insert; the tests are about the human decisions. */
async function seed(
  db: Database,
  clientId: string,
  o: {
    content: string;
    category: "style" | "tone" | "fact" | "preference";
    confidence: "low" | "medium" | "high";
    status: "observed" | "candidate";
  },
) {
  const [row] = await db
    .insert(memoryItems)
    .values({
      clientId,
      agent: "copywriter",
      category: o.category,
      sensitive: isSensitiveMemoryCategory(o.category),
      content: o.content,
      status: o.status,
      confidence: o.confidence,
      proposedByAgent: "copywriter",
    })
    .returning();
  await db.insert(memoryItemVersions).values({
    memoryId: row!.id,
    version: 1,
    content: o.content,
    category: o.category,
    authorAgent: "copywriter",
  });
  return row!;
}

describe.skipIf(!dbUrl)("agent memory (integration)", () => {
  let db: Database;
  let person: Actor;
  let clientId: string;
  const agent: Actor = { type: "agent", role: "copywriter" };
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    const [u] = await db
      .insert(users)
      .values({ name: "Laura", email: `memory-${suffix}@example.test` })
      .returning({ id: users.id });
    person = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" as const };
    const [c] = await db
      .insert(clients)
      .values({ name: "Rossi", slug: `rossi-${suffix}` })
      .returning({ id: clients.id });
    clientId = c!.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, (person as { id: string }).id));
  });

  it("agents only note or propose; people decide", async () => {
    const proposed = await seed(db, clientId, {
      content: "The client prefers titles without rhetorical questions.",
      category: "style",
      confidence: "medium",
      status: "candidate",
    });
    expect(proposed.status).toBe("candidate");
    await expect(approveMemory(db, agent, proposed.id)).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(
      addMemory(db, agent, { clientId, agent: "copywriter", category: "fact", content: "x x x" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      saveClientMemorySetting(db, agent, clientId, "slide_count", 5),
    ).rejects.toMatchObject({ code: "permission_denied" });

    expect(await approvedMemoriesFor(db, clientId, "copywriter")).toHaveLength(0);
    await approveMemory(db, person, proposed.id);
    expect((await approvedMemoriesFor(db, clientId, "copywriter")).map((m) => m.id)).toEqual([
      proposed.id,
    ]);
    // Someone else already decided it.
    await expect(rejectMemory(db, person, proposed.id, "Too vague")).rejects.toMatchObject({
      code: "conflict",
    });

    const edited = await editMemory(db, person, proposed.id, {
      content: "Titles never use rhetorical questions.",
    });
    expect(edited).toMatchObject({ version: 2, status: "approved" });
    const detail = await getMemory(db, person, proposed.id);
    expect(detail?.versions.map((v) => v.version)).toEqual([2, 1]);

    await db.insert(jobsLog).values({
      kind: "slides",
      clientId,
      status: "ok",
      inputSummary: { memory: [{ id: proposed.id, version: 2 }] },
      startedAt: new Date(),
    });
    expect((await getMemory(db, person, proposed.id))?.usedIn).toHaveLength(1);

    await archiveMemory(db, person, proposed.id);
    expect(await approvedMemoriesFor(db, clientId, "copywriter")).toHaveLength(0);
  });

  it("needs a note at low confidence, a reason to reject, and no bulk for sensitive ones", async () => {
    const low = await seed(db, clientId, {
      content: "Maybe avoid emoji.",
      category: "style",
      confidence: "low",
      status: "candidate",
    });
    await expect(approveMemory(db, person, low.id)).rejects.toMatchObject({ code: "validation" });
    await expect(rejectMemory(db, person, low.id, " ")).rejects.toMatchObject({
      code: "validation",
    });
    await rejectMemory(db, person, low.id, "Not true for this client");

    const tone = await seed(db, clientId, {
      content: "The tone is formal.",
      category: "tone",
      confidence: "high",
      status: "candidate",
    });
    expect(tone.sensitive).toBe(true);
    await expect(approveMemories(db, person, [tone.id])).rejects.toMatchObject({
      code: "validation",
    });

    const note = await seed(db, clientId, {
      content: "Carousels end with a question.",
      category: "preference",
      confidence: "high",
      status: "observed",
    });
    expect((await listMemories(db, person, { clientId })).some((m) => m.id === note.id)).toBe(
      false,
    );
    expect(
      (await listMemories(db, person, { clientId, status: "all" })).some((m) => m.id === note.id),
    ).toBe(true);
    await promoteMemory(db, person, note.id);
    expect(await approveMemories(db, person, [note.id])).toBe(1);
    expect(await memoryCounts(db, person, { clientId })).toEqual({ candidate: 1, approved: 1 });
  });

  it("stores typed settings and refuses invalid ones", async () => {
    await expect(
      saveClientMemorySetting(db, person, clientId, "slide_count", 25),
    ).rejects.toMatchObject({ code: "validation" });
    await saveClientMemorySetting(db, person, clientId, "slide_count", 5);
    await saveClientMemorySetting(db, person, clientId, "slide_count", 6);
    await saveClientMemorySetting(db, person, clientId, "default_cta", {
      text: "Book a free call",
      kind: "consultation",
    });
    const s = await loadClientMemorySettings(db, clientId);
    expect(s.slide_count).toMatchObject({ value: 6, version: 2, updatedByName: "Laura" });
    expect(s.default_cta?.value.text).toBe("Book a free call");
    await saveClientMemorySetting(db, person, clientId, "slide_count", null);
    expect((await loadClientMemorySettings(db, clientId)).slide_count).toBeUndefined();
  });
});
