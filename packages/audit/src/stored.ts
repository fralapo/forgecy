import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";

/**
 * A reason or label written by code into a column: the English text stays in the
 * column (logs, API, older readers) and the reference goes in its `*Ref` column, so
 * the interface shows it in the reader's language.
 */
export function stored(
  key: MessageKey & `audit.stored.${string}`,
  values?: MessageValues,
): { text: string; ref: MessageRef } {
  return { text: englishMessage(key, values), ref: messageRef(key, values) };
}
