import { getDb, sql } from "@forgecy/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness and database check used by Docker health checks and `forgecy health`. */
export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", service: "web", db: "ok", ms: Date.now() - started });
  } catch {
    return NextResponse.json(
      { status: "error", service: "web", db: "unreachable" },
      { status: 503 },
    );
  }
}
