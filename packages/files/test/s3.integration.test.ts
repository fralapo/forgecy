import { Readable } from "node:stream";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Driver } from "../src";

const endpoint = process.env.FORGECY_TEST_S3_ENDPOINT;

describe.skipIf(!endpoint)("S3Driver (integration)", () => {
  it("round-trips an object and presigns URLs", async () => {
    const bucket = process.env.FORGECY_TEST_S3_BUCKET ?? "forgecy-test";
    const driver = new S3Driver({
      bucket,
      region: "us-east-1",
      endpoint: endpoint!,
      accessKeyId: process.env.FORGECY_TEST_S3_ACCESS_KEY_ID ?? "minioadmin",
      secretAccessKey: process.env.FORGECY_TEST_S3_SECRET_ACCESS_KEY ?? "minioadmin",
      forcePathStyle: true,
    });
    await driver.client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
    const key = `system/test/${Date.now()}.txt`;
    await driver.put(key, Readable.from([Buffer.from("ciao")]), { contentType: "text/plain" });
    expect((await driver.head(key))?.size).toBe(4);
    const url = await driver.signedUrl(key, {
      expiresInSeconds: 60,
      disposition: "attachment",
      filename: "a.txt",
    });
    const res = await fetch(url);
    expect(await res.text()).toBe("ciao");
    const put = await driver.signedUploadUrl(key, {
      contentType: "text/plain",
      expiresInSeconds: 60,
    });
    expect(
      (
        await fetch(put, {
          method: "PUT",
          body: "nuovo",
          headers: { "Content-Type": "text/plain" },
        })
      ).ok,
    ).toBe(true);
    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
  });
});
