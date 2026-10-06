import type { Locale } from "@forgecy/core";
import type en from "../messages/en";

/** Every message, shaped like the English source files. */
export type Messages = typeof en;
export type Namespace = keyof Messages;

/**
 * One loader per language. Adding a language without its loader is a type error,
 * and the messages test fails if a folder and this list disagree.
 */
const loaders: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("../messages/en"),
  it: () => import("../messages/it"),
};

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

export async function loadMessages(locale: Locale): Promise<Messages> {
  const en = (await loaders.en()).default as Messages;
  if (locale === "en") return en;
  const translated = (await loaders[locale]()).default as Tree;
  return withFallback(en as unknown as Tree, translated) as unknown as Messages;
}

/** Raw messages of one language, without the English fallback (tests and tooling). */
export async function loadRawMessages(locale: Locale): Promise<Tree> {
  return (await loaders[locale]()).default as Tree;
}

export type { Tree as MessageTree };
