const linkedInExclusionPatterns = [
  /\bno\s+linkedin\b/,
  /\bnessun(?:a)?\s+(?:deliverable|contenuto|post|asset|pubblicazione)\s+linkedin\b/,
  /\b(?:non\s+(?:includere|aggiungere|creare|produrre|prevedere)|esclud(?:ere|i)|esclus[oa]|vietat[oa])\b.{0,80}\blinkedin\b/,
  /\blinkedin\b.{0,80}\b(?:esclus[oa]|non\s+(?:includere|richiesto|previsto)|vietat[oa])\b/,
];

export function linkedinAdaptationBlockReason(
  objective: string | null | undefined,
  strategy: Record<string, unknown> | null | undefined,
): string | null {
  const strategyText = [strategy?.objective, strategy?.calendar]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const brief = `${objective || ""} ${strategyText}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/\s+/g, " ");

  return linkedInExclusionPatterns.some((pattern) => pattern.test(brief))
    ? "Il brief della campagna esclude LinkedIn."
    : null;
}
