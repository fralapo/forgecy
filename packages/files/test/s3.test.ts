import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Driver } from "../src";

type Send = (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
const driverWith = (send: Send) =>
  new S3Driver({
    bucket: "b",
    region: "us-east-1",
    client: { send } as unknown as S3Client,
  });

/** A request that, like a stalled upload, only ends when it is aborted. */
const hangsUntilAborted: Send = (_command, options) =>
  new Promise((_resolve, reject) => {
    options?.abortSignal?.addEventListener("abort", () => reject(options.abortSignal!.reason));
  });

describe("S3Driver.put abort handling (mocked client)", () => {
  const key = "clients/11111111-1111-4111-8111-11111111111a/assets/x.png";

  it("aborts the request when the body stream errors, instead of hanging", async () => {
    const boom = new Error("checksum mismatch");
    const body = new Readable({ read() {} });
    const done = driverWith(hangsUntilAborted)
      .put(key, body, { contentType: "image/png", contentLength: 10 })
      .catch((e: unknown) => e);
    body.push(Buffer.from("abc"));
    body.destroy(boom);
    expect(await done).toBe(boom);
  });

  it("passes an abort signal that stays quiet when the body ends well", async () => {
    let signal: AbortSignal | undefined;
    await driverWith(async (_command, options) => {
      signal = options?.abortSignal;
      return {};
    }).put(key, Readable.from([Buffer.from("abc")]), {
      contentType: "image/png",
      contentLength: 3,
    });
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
  });
});
