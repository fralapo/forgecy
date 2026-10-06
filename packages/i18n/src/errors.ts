import { ForgecyError, type ForgecyErrorCode, type MessageRef } from "@forgecy/core";
import { createTranslator } from "use-intl/core";
import en from "../messages/en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Full key of any message, e.g. "errors.adminOnly" or "products.errors.notFound". */
export type MessageKey = Leaves<typeof en>;
export type MessageValues = Record<string, string | number>;

const english = createTranslator({ locale: "en", messages: en });

/** The English text of a message, for logs, the API and stored fallbacks. */
export function englishMessage(key: MessageKey, values?: MessageValues): string {
  return (english as unknown as (key: string, values?: MessageValues) => string)(key, values);
}

/** A reference to a message, stored or thrown now and translated when shown. */
export function messageRef(key: MessageKey, values?: MessageValues): MessageRef {
  return values ? { key, values } : { key };
}

/**
 * A ForgecyError whose message the interface shows in the user's language:
 * `throw localizedError("not_found", "products.errors.notFound")`.
 */
export function localizedError(
  code: ForgecyErrorCode,
  key: MessageKey,
  values?: MessageValues,
  details?: Record<string, unknown>,
): ForgecyError {
  return new ForgecyError(code, englishMessage(key, values), details, messageRef(key, values));
}
