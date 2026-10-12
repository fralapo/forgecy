import type { ProviderId } from "@forgecy/core";
import { readCapped } from "@forgecy/core/net-guard";
import { AiProviderError } from "./errors";

/** Biggest provider answer we parse: a few base64 images fit; anything bigger is a fault or an attack. */
export const MAX_JSON_BYTES = 64 * 1024 * 1024;

/** Error bodies only need a short head; truncates, never throws. */
export async function readText(res: Response, maxBytes = 4096): Promise<string> {
  try {
    return new TextDecoder().decode((await readCapped(res, maxBytes)).bytes);
  } catch {
    return "";
  }
}

/** Parses a provider answer without buffering more than `maxBytes` of it. */
export async function readJson(
  res: Response,
  provider: ProviderId,
  maxBytes = MAX_JSON_BYTES,
): Promise<unknown> {
  const { bytes, truncated } = await readCapped(res, maxBytes);
  if (truncated)
    throw new AiProviderError(
      "invalid_output",
      `${provider} answer is larger than ${maxBytes} bytes`,
      {
        provider,
      },
    );
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new AiProviderError("invalid_output", `${provider} answer is not valid JSON`, {
      provider,
      cause,
    });
  }
}
