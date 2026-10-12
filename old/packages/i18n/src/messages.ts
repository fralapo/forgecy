import type { Locale } from "@forgecy/core";
import en from "../messages/en";
import it from "../messages/it";

/** Every message, shaped like the English source files. */
export type Messages = typeof en;
export type Namespace = keyof Messages;

/**
 * Every language's messages. Adding a language without its entry is a type error,
 * and the messages test fails if a folder and this list disagree.
 */
const catalogs: Record<Locale, unknown> = { en, it };

type Tree = { [key: string]: string | Tree };

/** English first, then the language on top: a key missing in a translation shows in English. */
export function withFallback(base: Tree, overlay: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = out[key];
    out[key] =
      typeof value === "object" && typeof current === "object"
        ? withFallback(current, value)
        : value;
  }
  return out;
}

/** Messages of a language with the English fallback filled in (synchronous). */
export function messagesFor(locale: Locale): Messages {
  if (locale === "en") return en;
  return withFallback(en as unknown as Tree, catalogs[locale] as Tree) as unknown as Messages;
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  return messagesFor(locale);
}

/** Raw messages of one language, without the English fallback (tests and tooling). */
export async function loadRawMessages(locale: Locale): Promise<Tree> {
  return catalogs[locale] as Tree;
}

export type { Tree as MessageTree };
