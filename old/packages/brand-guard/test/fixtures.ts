import { brandIdentityDocumentSchema } from "@forgecy/brand/document";
import { defaultTokens, hexToDtcg, type TokenTree } from "@forgecy/brand/tokens";
import type { GuardBrand } from "../src/checks";
import type { GuardContent } from "../src/types";

export const sourced = <T>(id: string, value: T) => ({
  id,
  value,
  sourceIds: [],
  confidence: "high" as const,
});

export function brandTokens(): TokenTree {
  const t = defaultTokens() as {
    color: { reference: Record<string, unknown>; semantic: Record<string, unknown> };
    font: { family: Record<string, unknown> };
  };
  t.color.reference.espresso = { $value: hexToDtcg("#3B1F12") };
  t.color.reference.crema = { $value: hexToDtcg("#F4E9DC") };
  t.color.reference.sabbia = { $value: hexToDtcg("#D9C7B0") };
  t.color.semantic["brand-primary"] = { $value: "{color.reference.espresso}" };
  t.color.semantic.background = { $value: "{color.reference.crema}" };
  t.color.semantic.surface = { $value: "{color.reference.sabbia}" };
  t.font.family.display = { $value: ["Fraunces", "serif"] };
  t.font.family.body = { $value: ["Inter", "sans-serif"] };
  return t as unknown as TokenTree;
}

// An Italian brand on purpose: the vocabulary, claim and fact checks match Italian content.
export function brand(): GuardBrand {
  const document = brandIdentityDocumentSchema.parse({
    strategy: {
      messages: [
        sourced("m1", {
          kind: "claim",
          text: "Il miglior caffè per l'ufficio",
          proof: "Premio Barista 2024",
        }),
      ],
      avoidTopics: [sourced("t1", "politica")],
    },
    verbal: {
      forbiddenWords: ["economico", "low cost"],
      preferredWords: ["accessibile"],
      spellings: [{ term: "e-commerce" }],
      writingRules: sourced("w1", {
        maxSentenceWords: 12,
        emoji: "no",
        exclamations: "limited",
        maxHashtags: 3,
        ctaStyle: "Imperative verb, informal you",
      }),
    },
    visual: {
      typography: [
        sourced("f1", { role: "display", family: "Fraunces" }),
        sourced("f2", { role: "body", family: "Inter", fallback: "Arial, sans-serif" }),
      ],
    },
    content: {
      formats: [
        {
          id: "fmt1",
          key: "guida",
          name: "Practical guide",
          steps: [{ step: "hook" }, { step: "consigli" }, { step: "cta" }],
          maxWordsPerSlide: 20,
        },
      ],
    },
  });
  return {
    versionId: "00000000-0000-4000-8000-000000000001",
    number: 3,
    document,
    tokens: brandTokens(),
  };
}

/** A clean three-slide carousel: no findings expected. */
export function content(): GuardContent {
  return {
    channel: "instagram",
    formatKey: "guida",
    size: { width: 1080, height: 1350 },
    slides: [
      {
        layout: "cover",
        role: "cover",
        background: { token: "color.semantic.brand-primary" },
        slots: [
          {
            kind: "text",
            name: "title",
            label: "Title",
            role: "title",
            text: "Tre errori con la ==moka==",
            maxChars: 60,
            fontSizePx: 96,
            bold: true,
            color: { token: "color.semantic.on-brand-primary" },
            fontFamily: "Fraunces, serif",
          },
        ],
      },
      {
        layout: "list",
        role: "content",
        background: { token: "color.semantic.background" },
        slots: [
          {
            kind: "text",
            name: "title",
            label: "Title",
            role: "title",
            text: "Cosa evitare",
            maxChars: 40,
          },
          {
            kind: "list",
            name: "items",
            label: "List",
            items: ["Acqua oltre la valvola", "Caffè pressato", "Fuoco alto"],
            maxItems: 5,
            maxCharsPerItem: 40,
            color: { token: "color.semantic.text-primary" },
          },
        ],
      },
      {
        layout: "cta",
        role: "cta",
        background: { token: "color.semantic.background" },
        slots: [{ kind: "text", name: "cta", label: "CTA", role: "cta", text: "Salva il post" }],
      },
    ],
    caption: "La moka giusta, in tre mosse. #caffè #moka",
  };
}
