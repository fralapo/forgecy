"use client";

import {
  aiPolicies,
  AUDIT_LIMITS,
  prospectObjectives,
  socialChannels,
  type AiPolicy,
  type ProspectObjective,
  type SocialChannel,
} from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Save, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { checkDuplicatesAction, createProspectAction, updateProspectAction } from "../actions";
import { selectClass, textareaClass } from "../_lib/styles";

export interface ProspectFormValues {
  name: string;
  websiteUrl: string;
  sector: string;
  area: string;
  objectives: ProspectObjective[];
  otherObjective: string;
  notes: string;
  reportLanguage: "it" | "en";
  socialUrls: Partial<Record<SocialChannel, string>>;
}

const empty: ProspectFormValues = {
  name: "",
  websiteUrl: "",
  sector: "",
  area: "",
  objectives: [],
  otherObjective: "",
  notes: "",
  reportLanguage: "en",
  socialUrls: {},
};

/** Example profile address shown as a placeholder (a URL, not language). */
const profilePlaceholder = (channel: SocialChannel) => `${channel}.com/…`;

type Duplicate = { id: string; name: string; slug: string; reason: "domain" | "name" };

export function ProspectForm(
  props:
    | { mode: "create"; isAdmin: boolean; defaultPolicy: AiPolicy }
    | { mode: "edit"; clientId: string; rev: number; initial: ProspectFormValues },
) {
  const router = useRouter();
  const t = useTranslations("audit");
  const te = useTranslations("enums.aiPolicy");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const initial = props.mode === "edit" ? props.initial : empty;
  const [objectives, setObjectives] = useState<ProspectObjective[]>(initial.objectives);

  async function checkDuplicates(form: HTMLFormElement) {
    const f = new FormData(form);
    const found = await checkDuplicatesAction({
      name: String(f.get("name") ?? ""),
      websiteUrl: String(f.get("websiteUrl") ?? ""),
      ...(props.mode === "edit" ? { excludeId: props.clientId } : {}),
    });
    setDuplicates(found);
  }

  return (
    <form
      className="flex flex-col gap-6"
      onBlur={(e) => {
        const target: EventTarget = e.target;
        const name = target instanceof HTMLInputElement ? target.name : "";
        if (name === "name" || name === "websiteUrl") void checkDuplicates(e.currentTarget);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        const socialUrls: Partial<Record<SocialChannel, string>> = {};
        for (const c of socialChannels) if (v(`social_${c}`)) socialUrls[c] = v(`social_${c}`);
        const input = {
          name: v("name"),
          ...(v("websiteUrl") ? { websiteUrl: v("websiteUrl") } : {}),
          ...(v("sector") ? { sector: v("sector") } : {}),
          ...(v("area") ? { area: v("area") } : {}),
          objectives,
          ...(v("otherObjective") ? { otherObjective: v("otherObjective") } : {}),
          ...(v("notes") ? { notes: v("notes") } : {}),
          reportLanguage: (v("reportLanguage") || "en") as "it" | "en",
          socialUrls,
        };
        setError(null);
        setSaved(false);
        start(async () => {
          if (props.mode === "create") {
            const res = await createProspectAction({
              ...input,
              ...(v("aiPolicy") ? { aiPolicy: v("aiPolicy") as AiPolicy } : {}),
            });
            if (!res.ok) return setError(res.error);
            router.push(`/audit/${res.data!.slug}`);
          } else {
            const res = await updateProspectAction(props.clientId, input, props.rev);
            if (!res.ok) return setError(res.error);
            setSaved(true);
            router.refresh();
          }
        });
      }}
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-heading-sm text-fg">{t("prospectForm.company")}</legend>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="name">{t("prospectForm.name")}</Label>
          <Input id="name" name="name" required maxLength={120} defaultValue={initial.name} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="websiteUrl">{t("prospectForm.website")}</Label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            inputMode="url"
            placeholder={t("prospectForm.websitePlaceholder")}
            defaultValue={initial.websiteUrl}
          />
          <p className="text-body-sm text-fg-muted">
            {t("prospectForm.websiteHint", { max: AUDIT_LIMITS.maxPages })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sector">{t("prospectForm.sector")}</Label>
          <Input id="sector" name="sector" maxLength={80} defaultValue={initial.sector} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="area">{t("prospectForm.area")}</Label>
          <Input
            id="area"
            name="area"
            maxLength={120}
            placeholder={t("prospectForm.areaPlaceholder")}
            defaultValue={initial.area}
          />
        </div>
      </fieldset>

      {duplicates.length ? (
        <div
          role="status"
          className="flex gap-2 rounded-md border border-warning-fill p-3 text-body-sm"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
          <div>
            {t.rich("prospectForm.duplicates", {
              list: () =>
                duplicates.map((d, i) => (
                  <span key={d.id}>
                    {i ? ", " : ""}
                    <Link href={`/audit/${d.slug}`} className="text-link underline">
                      {d.name}
                    </Link>{" "}
                    ({t(`prospectForm.duplicateReason.${d.reason}`)})
                  </span>
                )),
            })}
          </div>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-heading-sm text-fg">{t("prospectForm.goals")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {prospectObjectives.map((o) => (
            <label key={o} className="flex items-center gap-2 text-body-sm text-fg">
              <input
                type="checkbox"
                checked={objectives.includes(o)}
                onChange={(e) =>
                  setObjectives((prev) =>
                    e.target.checked ? [...prev, o] : prev.filter((x) => x !== o),
                  )
                }
              />
              {t(`objective.${o}`)}
            </label>
          ))}
        </div>
        {objectives.includes("other") ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="otherObjective">{t("prospectForm.otherGoal")}</Label>
            <Input
              id="otherObjective"
              name="otherObjective"
              required
              maxLength={200}
              defaultValue={initial.otherObjective}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">{t("prospectForm.notes")}</Label>
          <textarea
            id="notes"
            name="notes"
            maxLength={4000}
            className={textareaClass}
            placeholder={t("prospectForm.notesPlaceholder")}
            defaultValue={initial.notes}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-heading-sm text-fg">{t("prospectForm.socialProfiles")}</legend>
        <p className="text-body-sm text-fg-muted sm:col-span-2">{t("prospectForm.socialHint")}</p>
        {socialChannels.map((c) => (
          <div key={c} className="flex flex-col gap-2">
            <Label htmlFor={`social_${c}`}>{t(`channel.${c}`)}</Label>
            <Input
              id={`social_${c}`}
              name={`social_${c}`}
              inputMode="url"
              placeholder={profilePlaceholder(c)}
              defaultValue={initial.socialUrls[c] ?? ""}
            />
          </div>
        ))}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-heading-sm text-fg">{t("prospectForm.reportAndAi")}</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reportLanguage">{t("prospectForm.reportLanguage")}</Label>
          <select
            id="reportLanguage"
            name="reportLanguage"
            className={selectClass}
            defaultValue={initial.reportLanguage}
          >
            <option value="en">{t("prospectForm.language.en")}</option>
            <option value="it">{t("prospectForm.language.it")}</option>
          </select>
        </div>
        {props.mode === "create" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="aiPolicy">{t("prospectForm.aiPolicy")}</Label>
            {props.isAdmin ? (
              <select
                id="aiPolicy"
                name="aiPolicy"
                className={selectClass}
                defaultValue={props.defaultPolicy}
              >
                {aiPolicies.map((p) => (
                  <option key={p} value={p}>
                    {te(p)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-body-sm text-fg-muted">
                {t("prospectForm.aiPolicyFixed", { policy: te(props.defaultPolicy) })}
              </p>
            )}
          </div>
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-body-sm text-success">
          {t("prospectForm.saved")}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          <Save aria-hidden />
          {props.mode === "create" ? t("prospectForm.create") : t("prospectForm.save")}
        </Button>
      </div>
    </form>
  );
}
