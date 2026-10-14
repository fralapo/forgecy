import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiFailure } from "../../lib/http";
import { validateOpenRouterApiKey } from "../../lib/openrouter-credentials";

test("OpenRouter key verification sends the candidate only to the models endpoint", async () => {
  let receivedUrl = "";
  let receivedAuthorization = "";
  await validateOpenRouterApiKey("test-openrouter-key-123456", async (input, init) => {
    receivedUrl = String(input);
    receivedAuthorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  assert.equal(receivedUrl, "https://openrouter.ai/api/v1/models");
  assert.equal(receivedAuthorization, "Bearer test-openrouter-key-123456");
});

test("OpenRouter key verification gives a clear error for rejected keys", async () => {
  await assert.rejects(
    validateOpenRouterApiKey("invalid-openrouter-key-123456", async () => new Response("unauthorized", { status: 401 })),
    (error: unknown) => error instanceof ApiFailure && error.status === 422 && /non ha accettato/.test(error.message)
  );
});

test("OpenRouter key verification reports connectivity errors without logging the key", async () => {
  await assert.rejects(
    validateOpenRouterApiKey("test-openrouter-key-123456", async () => { throw new TypeError("offline"); }),
    (error: unknown) => error instanceof ApiFailure && error.status === 502 && /non è raggiungibile/.test(error.message)
  );
});
