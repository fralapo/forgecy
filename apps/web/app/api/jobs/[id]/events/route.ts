import { getDb } from "@forgecy/db";
import { jobVisibleTo, subscribeJobEvents } from "@forgecy/jobs";
import { z } from "zod";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Job progress as Server-Sent Events, read from the persistent jobs row until a final state. */
export const GET = withUser(
  async (user, request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return new Response("Not found", { status: 404 });
    if (!(await jobVisibleTo(getDb(), user.actor, id.data)))
      return new Response("Not found", { status: 404 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of subscribeJobEvents(getDb(), id.data, {
            signal: request.signal,
          })) {
            controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(event)}\n\n`));
          }
        } catch {
          controller.enqueue(encoder.encode(`event: error\ndata: {}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  },
);
