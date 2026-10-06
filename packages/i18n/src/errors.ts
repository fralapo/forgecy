import { ForgecyError, type ForgecyErrorCode, type MessageRef } from "@forgecy/core";
import { createTranslator } from "use-intl/core";
import en from "../messages/en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Keys of the `errors` namespace, e.g. "adminOnly" or "products.notFound". */
export type ErrorKey = Leaves<typeof en.errors>;
export type ErrorValues = Record<string, string | number>;

const english = createTranslator({ locale: "en", messages: en, namespace: "errors" });

/** The English text of an error message, for logs and the API. */
export function englishError(key: ErrorKey, values?: ErrorValues): string {
  return (english as (key: string, values?: ErrorValues) => string)(key, values);
}

export function errorRef(key: ErrorKey, values?: ErrorValues): MessageRef {
  return values ? { key, values } : { key };
}

/**
 * A ForgecyError whose message the interface shows in the user's language:
 * `throw localizedError("not_found", "products.notFound")`.
 */
export function localizedError(
  code: ForgecyErrorCode,
  key: ErrorKey,
  values?: ErrorValues,
  details?: Record<string, unknown>,
): ForgecyError {
  return new ForgecyError(code, englishError(key, values), details, errorRef(key, values));
}
