import { createServer, type Server } from "node:http";
import { type Database, sql } from "@forgecy/db";

/** GET /health for Docker and `forgecy health`: checks the database and that the worker loop is up. */
export function startHealthServer(port: number, db: Database, isRunning: () => boolean): Server {
  const server = createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    let dbOk = true;
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbOk = false;
    }
    const ok = dbOk && isRunning();
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: ok ? "ok" : "error",
        service: "worker",
        db: dbOk ? "ok" : "unreachable",
      }),
    );
  });
  server.listen(port);
  return server;
}
