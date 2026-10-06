/**
 * What the block pages show for each field of a section. The values follow the
 * document schema of @forgecy/brand; the server validates them again on save.
 */
import {
  awarenessLevels,
  channelKeys,
  funnelStages,
  logoRoles,
  messageKinds,
  toneAxes,
  typographyRoles,
  type DocumentSectionKey,
} from "@forgecy/brand/client";

export type Option = { value: string; label: string };
const opts = (values: readonly string[], labels: Record<string, string> = {}): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

export type Ctl =
  | { kind: "text"; key: string; label: string; hint?: string }
  | { kind: "textarea"; key: string; label: string; hint?: string; maxWords?: number }
  | { kind: "number"; key: string; label: string; min?: number; max?: number }
  | { kind: "select"; key: string; label: string; options: Option[]; required?: boolean }
  | { kind: "scale"; key: string; label: string; min: number; max: number }
  | { kind: "lines"; key: string; label: string; hint?: string }
  | { kind: "numbers"; key: string; label: string; hint?: string }
  | { kind: "list"; key: string; label: string; item: Ctl[]; withId?: boolean; addLabel: string }
  | { kind: "source"; key: string; label: string };

export type FieldUi =
  | {
      kind: "sourced";
      key: string;
      label: string;
      multiline?: boolean;
      hint?: string;
      maxWords?: number;
    }
  | { kind: "sourced-object"; key: string; label: string; item: Ctl[] }
  | {
      kind: "sourced-list";
      key: string;
      label: string;
      item: Ctl[] | "text";
      addLabel: string;
      hint?: string;
    }
  | { kind: "lines"; key: string; label: string; hint?: string }
  | { kind: "object"; key: string; label: string; item: Ctl[] }
  | { kind: "list"; key: string; label: string; item: Ctl[]; withId?: boolean; addLabel: string };

export interface SectionUi {
  section: DocumentSectionKey;
  title: string;
  /** "list" when the section itself is an array (channels). */
  root?: "list";
  fields: FieldUi[];
}

const awarenessLabels: Record<string, string> = {
  unaware: "Non consapevole",
  problem_aware: "Consapevole del problema",
  solution_aware: "Consapevole della soluzione",
  product_aware: "Conosce il prodotto",
  most_aware: "Pronto all'acquisto",
};
const messageLabels: Record<string, string> = {
  value_proposition: "Value proposition",
  tagline: "Tagline",
  claim: "Claim",
  proof_point: "Prova",
  reason_to_believe: "Reason to believe",
  elevator_pitch: "Elevator pitch",
  objection: "Obiezione",
  cta: "CTA",
};
const logoLabels: Record<string, string> = {
  logo_primary: "Logo principale",
  logo_secondary: "Logo secondario",
  symbol: "Simbolo",
  wordmark: "Logotipo",
  logo_mono: "Monocromatico",
  logo_negative: "Negativo",
  favicon: "Favicon",
};
const typoLabels: Record<string, string> = { display: "Titoli", body: "Testo", data: "Dati" };
const funnelLabels: Record<string, string> = {
  awareness: "Notorietà",
  consideration: "Considerazione",
  conversion: "Conversione",
  loyalty: "Fidelizzazione",
};
const triple = (a: string, b: string, c: string) => [
  { value: "no", label: a },
  { value: "limited", label: b },
  { value: "yes", label: c },
];

export const strategyUi: SectionUi = {
  section: "strategy",
  title: "Strategia",
  fields: [
    {
      kind: "sourced",
      key: "oneLiner",
      label: "One-liner",
      hint: "Chi siete e perché contate, in meno di 20 parole.",
      maxWords: 20,
    },
    { kind: "sourced", key: "insight", label: "Insight", multiline: true },
    { kind: "sourced", key: "positioning", label: "Posizionamento", multiline: true },
    { kind: "sourced", key: "promise", label: "Promessa", multiline: true },
    { kind: "sourced", key: "differentiation", label: "Differenziazione", multiline: true },
    { kind: "sourced", key: "mission", label: "Missione", multiline: true },
    { kind: "sourced", key: "vision", label: "Visione", multiline: true },
    { kind: "sourced", key: "category", label: "Categoria" },
    {
      kind: "sourced-list",
      key: "values",
      label: "Valori",
      addLabel: "Aggiungi valore",
      item: [
        { kind: "text", key: "name", label: "Nome" },
        { kind: "textarea", key: "description", label: "Che cosa significa" },
      ],
    },
    {
      kind: "sourced-list",
      key: "audience",
      label: "Pubblico",
      addLabel: "Aggiungi segmento",
      item: [
        { kind: "text", key: "name", label: "Segmento" },
        { kind: "text", key: "role", label: "Ruolo" },
        { kind: "text", key: "sector", label: "Settore" },
        {
          kind: "select",
          key: "awareness",
          label: "Consapevolezza",
          options: opts(awarenessLevels, awarenessLabels),
        },
        { kind: "textarea", key: "goals", label: "Obiettivi" },
        { kind: "textarea", key: "problems", label: "Problemi" },
        { kind: "textarea", key: "fears", label: "Paure" },
        { kind: "textarea", key: "objections", label: "Obiezioni" },
        { kind: "textarea", key: "triggers", label: "Motivazioni d'acquisto" },
        { kind: "textarea", key: "language", label: "Linguaggio" },
        { kind: "text", key: "channels", label: "Canali" },
        { kind: "textarea", key: "alternatives", label: "Alternative" },
      ],
    },
    {
      kind: "sourced-list",
      key: "messages",
      label: "Messaggi e claim",
      addLabel: "Aggiungi messaggio",
      hint: "Ogni claim ha bisogno di una prova: senza, va confermato prima di pubblicare.",
      item: [
        {
          kind: "select",
          key: "kind",
          label: "Tipo",
          options: opts(messageKinds, messageLabels),
          required: true,
        },
        { kind: "textarea", key: "text", label: "Testo" },
        { kind: "textarea", key: "proof", label: "Prova o fonte" },
        { kind: "textarea", key: "answer", label: "Risposta (per le obiezioni)" },
      ],
    },
    {
      kind: "sourced-list",
      key: "avoidTopics",
      label: "Temi da evitare",
      addLabel: "Aggiungi tema",
      item: "text",
    },
  ],
};

export const competitorsUi: SectionUi = {
  section: "competitors",
  title: "Concorrenti",
  fields: [
    {
      kind: "sourced-list",
      key: "list",
      label: "Concorrenti",
      addLabel: "Aggiungi concorrente",
      item: [
        { kind: "text", key: "name", label: "Nome" },
        {
          kind: "select",
          key: "kind",
          label: "Tipo",
          options: [
            { value: "direct", label: "Diretto" },
            { value: "indirect", label: "Indiretto" },
            { value: "alternative", label: "Alternativa" },
          ],
          required: true,
        },
        { kind: "text", key: "url", label: "Sito" },
        { kind: "textarea", key: "notes", label: "Note" },
      ],
    },
    { kind: "lines", key: "overusedMessages", label: "Messaggi abusati nel settore" },
    { kind: "lines", key: "commonVisualCodes", label: "Codici visivi comuni" },
    { kind: "lines", key: "openSpaces", label: "Spazi liberi" },
  ],
};

export const verbalUi: SectionUi = {
  section: "verbal",
  title: "Verbale",
  fields: [
    {
      kind: "sourced",
      key: "voice",
      label: "Voce",
      multiline: true,
      hint: "Costante in ogni canale.",
    },
    {
      kind: "sourced-list",
      key: "toneAxes",
      label: "Assi del tono",
      addLabel: "Aggiungi asse",
      hint: "Un aggettivo senza esempi non basta: servono una frase giusta e una sbagliata.",
      item: [
        {
          kind: "select",
          key: "axis",
          label: "Asse",
          options: toneAxes.map((a) => ({ value: a.key, label: `${a.left} / ${a.right}` })),
          required: true,
        },
        {
          kind: "scale",
          key: "value",
          label: "Posizione (1 = sinistra, 5 = destra)",
          min: 1,
          max: 5,
        },
        { kind: "textarea", key: "goodExample", label: "Frase giusta" },
        { kind: "textarea", key: "badExample", label: "Frase sbagliata" },
      ],
    },
    {
      kind: "sourced-list",
      key: "weAreWeAreNot",
      label: "Siamo / Non siamo",
      addLabel: "Aggiungi riga",
      item: [
        { kind: "text", key: "weAre", label: "Siamo" },
        { kind: "text", key: "weAreNot", label: "Non siamo" },
      ],
    },
    {
      kind: "sourced-object",
      key: "writingRules",
      label: "Regole di scrittura",
      item: [
        {
          kind: "select",
          key: "person",
          label: "Persona",
          options: opts(["tu", "lei", "voi", "noi", "impersonale"]),
        },
        {
          kind: "select",
          key: "emoji",
          label: "Emoji",
          options: triple("Mai", "Con moderazione", "Ammesse"),
        },
        {
          kind: "number",
          key: "maxSentenceWords",
          label: "Parole massime per frase",
          min: 3,
          max: 80,
        },
        { kind: "number", key: "maxHashtags", label: "Hashtag massimi", min: 0, max: 30 },
        {
          kind: "select",
          key: "anglicisms",
          label: "Anglicismi",
          options: [
            { value: "avoid", label: "Da evitare" },
            { value: "limited", label: "Pochi" },
            { value: "allowed", label: "Ammessi" },
          ],
        },
        {
          kind: "select",
          key: "exclamations",
          label: "Punti esclamativi",
          options: triple("Mai", "Rari", "Ammessi"),
        },
        { kind: "text", key: "capitalization", label: "Maiuscole" },
        { kind: "text", key: "numbers", label: "Numeri" },
        { kind: "text", key: "ctaStyle", label: "Stile delle CTA" },
        { kind: "text", key: "headlineStyle", label: "Stile dei titoli" },
        { kind: "text", key: "captionStyle", label: "Stile delle caption" },
        { kind: "textarea", key: "notes", label: "Note" },
      ],
    },
    { kind: "lines", key: "preferredWords", label: "Parole preferite", hint: "Una per riga." },
    { kind: "lines", key: "forbiddenWords", label: "Parole vietate", hint: "Una per riga." },
    {
      kind: "list",
      key: "spellings",
      label: "Grafie corrette",
      addLabel: "Aggiungi termine",
      item: [
        { kind: "text", key: "term", label: "Termine" },
        { kind: "text", key: "note", label: "Nota" },
      ],
    },
  ],
};

export const visualUi: SectionUi = {
  section: "visual",
  title: "Visual",
  fields: [
    {
      kind: "object",
      key: "logo",
      label: "Logo",
      item: [
        {
          kind: "list",
          key: "variants",
          label: "Varianti",
          withId: true,
          addLabel: "Aggiungi variante",
          item: [
            {
              kind: "select",
              key: "role",
              label: "Ruolo",
              options: opts(logoRoles, logoLabels),
              required: true,
            },
            { kind: "source", key: "sourceId", label: "File" },
            {
              kind: "select",
              key: "background",
              label: "Sfondo",
              options: [
                { value: "any", label: "Qualsiasi" },
                { value: "light", label: "Chiaro" },
                { value: "dark", label: "Scuro" },
              ],
              required: true,
            },
            { kind: "text", key: "note", label: "Nota" },
          ],
        },
        { kind: "text", key: "clearSpace", label: "Area di rispetto" },
        { kind: "number", key: "minSizePx", label: "Dimensione minima (px)", min: 4, max: 2000 },
        { kind: "text", key: "allowedBackgrounds", label: "Sfondi ammessi" },
        { kind: "lines", key: "forbiddenUses", label: "Usi vietati" },
      ],
    },
    {
      kind: "sourced-list",
      key: "typography",
      label: "Tipografia",
      addLabel: "Aggiungi font",
      item: [
        {
          kind: "select",
          key: "role",
          label: "Ruolo",
          options: opts(typographyRoles, typoLabels),
          required: true,
        },
        { kind: "text", key: "family", label: "Famiglia" },
        {
          kind: "numbers",
          key: "weights",
          label: "Pesi",
          hint: "Separati da virgola, es. 400, 700.",
        },
        { kind: "text", key: "fallback", label: "Alternativa" },
        { kind: "text", key: "license", label: "Licenza" },
        {
          kind: "select",
          key: "licenseStatus",
          label: "Stato della licenza",
          options: [
            { value: "to_verify", label: "Da verificare" },
            { value: "verified", label: "Verificata" },
          ],
          required: true,
        },
        { kind: "source", key: "sourceId", label: "File del font" },
      ],
    },
    {
      kind: "sourced-object",
      key: "imagery",
      label: "Fotografia e illustrazione",
      item: [
        { kind: "lines", key: "subjects", label: "Soggetti" },
        { kind: "lines", key: "settings", label: "Ambienti" },
        { kind: "lines", key: "framing", label: "Inquadrature" },
        { kind: "lines", key: "lighting", label: "Luce" },
        { kind: "lines", key: "colorMood", label: "Colore e atmosfera" },
        { kind: "text", key: "people", label: "Persone" },
        { kind: "textarea", key: "illustration", label: "Illustrazione" },
        { kind: "lines", key: "forbidden", label: "Da evitare" },
      ],
    },
    {
      kind: "object",
      key: "layout",
      label: "Impaginazione",
      item: [
        { kind: "text", key: "grid", label: "Griglia" },
        { kind: "text", key: "margins", label: "Margini" },
        {
          kind: "number",
          key: "maxElements",
          label: "Elementi massimi per slide",
          min: 1,
          max: 30,
        },
        { kind: "text", key: "logoPosition", label: "Posizione del logo" },
        { kind: "text", key: "ctaPosition", label: "Posizione della CTA" },
        { kind: "text", key: "textDensity", label: "Densità del testo" },
        { kind: "textarea", key: "notes", label: "Note" },
      ],
    },
    { kind: "lines", key: "do", label: "Da fare" },
    { kind: "lines", key: "dont", label: "Da non fare" },
  ],
};

export const contentUi: SectionUi = {
  section: "content",
  title: "Contenuti",
  fields: [
    {
      kind: "sourced-list",
      key: "pillars",
      label: "Pilastri",
      addLabel: "Aggiungi pilastro",
      item: [
        {
          kind: "text",
          key: "key",
          label: "Chiave",
          hint: "Minuscole e trattini, es. dietro-le-quinte.",
        },
        { kind: "text", key: "name", label: "Nome" },
        { kind: "textarea", key: "goal", label: "Obiettivo" },
        {
          kind: "select",
          key: "funnel",
          label: "Fase del funnel",
          options: opts(funnelStages, funnelLabels),
        },
        { kind: "lines", key: "themes", label: "Temi" },
        {
          kind: "text",
          key: "emotion",
          label: "Emozione",
          hint: "Specifica: «sollievo», non «positiva».",
        },
        { kind: "text", key: "frequency", label: "Frequenza" },
        { kind: "text", key: "cta", label: "CTA" },
        { kind: "lines", key: "forbidden", label: "Vietato" },
      ],
    },
    {
      kind: "list",
      key: "formats",
      label: "Format",
      withId: true,
      addLabel: "Aggiungi format",
      item: [
        { kind: "text", key: "key", label: "Chiave" },
        { kind: "text", key: "name", label: "Nome" },
        { kind: "textarea", key: "goal", label: "Obiettivo" },
        {
          kind: "list",
          key: "steps",
          label: "Sequenza",
          addLabel: "Aggiungi passo",
          item: [
            { kind: "text", key: "step", label: "Passo" },
            { kind: "text", key: "layout", label: "Layout" },
          ],
        },
        {
          kind: "number",
          key: "maxWordsPerSlide",
          label: "Parole massime per slide",
          min: 1,
          max: 200,
        },
        { kind: "text", key: "cta", label: "CTA" },
      ],
    },
  ],
};

export const channelsUi: SectionUi = {
  section: "channels",
  title: "Canali",
  root: "list",
  fields: [
    {
      kind: "sourced-list",
      key: "",
      label: "Regole per canale",
      addLabel: "Aggiungi canale",
      item: [
        {
          kind: "select",
          key: "channel",
          label: "Canale",
          options: opts(channelKeys),
          required: true,
        },
        { kind: "textarea", key: "goal", label: "Obiettivo" },
        { kind: "textarea", key: "toneShift", label: "Come cambia il tono" },
        { kind: "text", key: "formats", label: "Format" },
        { kind: "text", key: "frequency", label: "Frequenza" },
        { kind: "lines", key: "hashtags", label: "Hashtag" },
        { kind: "text", key: "cta", label: "CTA" },
        { kind: "textarea", key: "notes", label: "Note" },
      ],
    },
  ],
};
