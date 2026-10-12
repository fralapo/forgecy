import "server-only";
import type { ValidationCheck, ValidationIssue } from "@forgecy/carousel";
import { getTranslations } from "next-intl/server";
import { refText } from "@/lib/i18n";

/** A check label in the user's language; reports saved before translations show their English. */
export async function checkText(check: ValidationCheck): Promise<string> {
  return refText(check.ref, check.label);
}

/** “`layouts/cover.html`, line 14: hand-written color `#FF0000`.” in the user's language. */
export async function issueText(issue: ValidationIssue): Promise<string> {
  const t = await getTranslations("templates.detail.validation");
  let ref = issue.ref;
  if (ref && issue.detailRef) {
    const detail = await refText(issue.detailRef, String(ref.values?.detail ?? ""));
    ref = { ...ref, values: { ...ref.values, detail } };
  }
  const message = await refText(ref, issue.message);
  if (!issue.file) return message;
  return issue.line
    ? t("issueInFileLine", { file: issue.file, line: String(issue.line), message })
    : t("issueInFile", { file: issue.file, message });
}
