import { z } from "zod";
import type { JsonSchema } from "./types";

/** Zod -> JSON Schema (draft 2020-12, output shape) via Zod 4's native converter. */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

const supportedStringFormats = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

/**
 * Reduce a JSON Schema to the subset accepted by Anthropic structured outputs:
 * every object closed (`additionalProperties: false`), unsupported constraints
 * (minLength, maximum, pattern, ...) moved into `description` as hints. Zod
 * re-validates the full constraints afterwards, so nothing is lost.
 * Unlike the SDK's transformJSONSchema this keeps `enum` and `const`.
 */
export function toAnthropicSchema(schema: JsonSchema): JsonSchema {
  return transform(structuredClone(schema));
}

function transform(input: Record<string, unknown>): Record<string, unknown> {
  const s = { ...input };
  const out: Record<string, unknown> = {};
  const take = (k: string) => {
    const v = s[k];
    delete s[k];
    return v;
  };

  const defs = take("$defs") as Record<string, Record<string, unknown>> | undefined;
  if (defs) out.$defs = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, transform(v)]));
  const ref = take("$ref");
  if (ref !== undefined) {
    out.$ref = ref;
    return out;
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const list = take(key);
    if (Array.isArray(list))
      out[key === "oneOf" ? "anyOf" : key] = list.map((v) =>
        transform(v as Record<string, unknown>),
      );
  }
  const type = take("type");
  if (type !== undefined) out.type = type;
  for (const k of ["description", "title", "enum", "const", "default"]) {
    const v = take(k);
    if (v !== undefined) out[k] = v;
  }
  if (type === "object") {
    const props = (take("properties") as Record<string, Record<string, unknown>> | undefined) ?? {};
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, transform(v)]));
    take("additionalProperties");
    out.additionalProperties = false;
    const required = take("required");
    if (required !== undefined) out.required = required;
  } else if (type === "array") {
    const items = take("items");
    if (items && typeof items === "object") out.items = transform(items as Record<string, unknown>);
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) s.minItems = minItems;
  } else if (type === "string") {
    const format = take("format");
    if (typeof format === "string" && supportedStringFormats.has(format)) out.format = format;
    else if (format !== undefined) s.format = format;
  }
  const rest = Object.entries(s);
  if (rest.length > 0) {
    const hint = `{${rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}}`;
    out.description = typeof out.description === "string" ? `${out.description}\n\n${hint}` : hint;
  }
  return out;
}

/**
 * OpenAI strict mode requires every object property to be listed in `required`
 * and `additionalProperties: false`. Returns false when the schema has optional
 * fields; the adapter then sends `strict: false` and relies on Zod validation.
 */
export function isStrictCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictCompatible);
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.type === "object" || s.properties) {
    const keys = Object.keys((s.properties as Record<string, unknown>) ?? {});
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    if (s.additionalProperties !== false) return false;
    if (!keys.every((k) => required.includes(k))) return false;
  }
  return Object.values(s).every((v) => (v && typeof v === "object" ? isStrictCompatible(v) : true));
}

/** Format Zod issues as a short, model-readable list for the retry prompt. */
export function formatZodIssues(error: z.ZodError, max = 20): string {
  const lines = error.issues
    .slice(0, max)
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
  if (error.issues.length > max) lines.push(`- ... ${error.issues.length - max} more`);
  return lines.join("\n");
}
