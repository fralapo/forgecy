import type { Env } from "@forgecy/core";
import type { StorageDriver } from "./driver";
import { LocalDiskDriver } from "./local";
import { S3Driver } from "./s3";
import { deriveFileSigningSecret } from "./signing";

type StorageEnv = Pick<
  Env,
  | "STORAGE_DRIVER"
  | "MEDIA_ROOT"
  | "FORGECY_BASE_URL"
  | "BETTER_AUTH_SECRET"
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_FORCE_PATH_STYLE"
>;

/** HMAC key for local signed file URLs; the web file route must use the same value. */
export function fileSigningSecretFromEnv(env: Pick<Env, "BETTER_AUTH_SECRET">): string {
  return deriveFileSigningSecret(env.BETTER_AUTH_SECRET);
}

/** Build the storage driver selected by STORAGE_DRIVER. */
export function createStorageFromEnv(env: StorageEnv): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Driver({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      ...(env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID } : {}),
      ...(env.S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY } : {}),
      // The bool env helper turns "unset" into false; MinIO needs path style, so default on with an endpoint.
      forcePathStyle: env.S3_FORCE_PATH_STYLE || Boolean(env.S3_ENDPOINT),
    });
  }
  return new LocalDiskDriver({
    root: env.MEDIA_ROOT,
    baseUrl: env.FORGECY_BASE_URL,
    secret: fileSigningSecretFromEnv(env),
  });
}
