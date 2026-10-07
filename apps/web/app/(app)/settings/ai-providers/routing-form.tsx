"use client";

import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { saveRoutingAction, type RoutingState } from "../actions";
import { controlClass } from "../../content/_components/action-button";
import { LiveModelField, type CatalogProvider } from "./live-model-field";

/** The BYOK providers whose model list can be searched live; "local" has none. */
function catalogProviderOf(id: string): CatalogProvider | undefined {
  return id === "openai" || id === "anthropic" || id === "openrouter" || id === "deepseek"
    ? id
    : undefined;
}

export interface ProviderOption {
  id: string;
  name: string;
  ready: boolean;
  defaultModel: string;
}

export interface RoutingInitial {
  text: { provider: string; model: string; fallback?: { provider: string; model: string } };
  images: Array<{ provider: string; model: string }>;
}

/** A compact "is this service ready to use" badge — reused everywhere a service is picked. */
function ReadyBadge({ ready, label }: { ready: boolean; label: string }) {
  return <Badge variant={ready ? "success" : "neutral"}>{label}</Badge>;
}

/**
 * Free choice of service and model: the text provider and model (with an optional
 * fallback) and the image providers in order of use. Unconfigured providers can be
 * chosen too; they are skipped until their key or connection exists.
 */
export function RoutingForm({
  text,
  images,
  initial,
}: {
  text: ProviderOption[];
  images: ProviderOption[];
  initial: RoutingInitial;
}) {
  const [state, action, pending] = useActionState<RoutingState, FormData>(saveRoutingAction, {});
  const t = useTranslations("settings.aiProviders.routing");
  const ta = useTranslations("settings.aiProviders");
  const tp = useTranslations("settings.providers");
  const tc = useTranslations("common");
  const [textProvider, setTextProvider] = useState(initial.text.provider);
  const [fallbackProvider, setFallbackProvider] = useState(initial.text.fallback?.provider ?? "");
  const position = (id: string) => {
    const i = initial.images.findIndex((x) => x.provider === id);
    return i < 0 ? "" : String(i + 1);
  };
  const [positions, setPositions] = useState<Record<string, string>>(() =>
    Object.fromEntries(images.map((o) => [o.id, position(o.id)])),
  );
  const label = (o: ProviderOption) => (o.ready ? o.name : t("notReady", { name: o.name }));
  const textDefault = (id: string | undefined) => text.find((o) => o.id === id)?.defaultModel ?? "";
  const selectedText = text.find((o) => o.id === textProvider);
  const selectedFallback = text.find((o) => o.id === fallbackProvider);
  const roleLabel = (pos: string) =>
    pos === "1" ? ta("primary") : pos === "2" ? ta("secondary") : pos === "" ? t("off") : pos;
  const roleVariant = (pos: string) => (pos === "1" || pos === "2" ? "success" : "neutral");

  return (
    <form action={action} className="grid gap-6">
      <fieldset className="grid gap-4">
        <legend className="text-label text-fg">{t("textTitle")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-3 rounded-md border border-subtle p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-fg">{ta("primary")}</span>
              {selectedText ? (
                <ReadyBadge
                  ready={selectedText.ready}
                  label={tp(selectedText.ready ? "configured" : "notConfigured")}
                />
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-text-provider">{t("provider")}</Label>
              <select
                id="rt-text-provider"
                name="text.provider"
                value={textProvider}
                onChange={(e) => setTextProvider(e.target.value)}
                className={controlClass}
              >
                {text.map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-text-model">{t("model")}</Label>
              {catalogProviderOf(textProvider) ? (
                <LiveModelField
                  provider={catalogProviderOf(textProvider)!}
                  id="rt-text-model"
                  name="text.model"
                  defaultValue={initial.text.model}
                  placeholder={textDefault(textProvider)}
                />
              ) : (
                <Input
                  id="rt-text-model"
                  name="text.model"
                  defaultValue={initial.text.model}
                  placeholder={textDefault(textProvider)}
                  maxLength={200}
                />
              )}
            </div>
          </div>
          <div className="grid gap-3 rounded-md border border-subtle p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-fg-muted">{ta("secondary")}</span>
              {selectedFallback ? (
                <ReadyBadge
                  ready={selectedFallback.ready}
                  label={tp(selectedFallback.ready ? "configured" : "notConfigured")}
                />
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-fb-provider">{t("fallbackProvider")}</Label>
              <select
                id="rt-fb-provider"
                name="text.fallback.provider"
                value={fallbackProvider}
                onChange={(e) => setFallbackProvider(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("none")}</option>
                {text.map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-fb-model">{t("model")}</Label>
              {catalogProviderOf(fallbackProvider) ? (
                <LiveModelField
                  provider={catalogProviderOf(fallbackProvider)!}
                  id="rt-fb-model"
                  name="text.fallback.model"
                  defaultValue={initial.text.fallback?.model ?? ""}
                  placeholder={textDefault(fallbackProvider)}
                />
              ) : (
                <Input
                  id="rt-fb-model"
                  name="text.fallback.model"
                  defaultValue={initial.text.fallback?.model ?? ""}
                  maxLength={200}
                />
              )}
            </div>
          </div>
        </div>
        <p className="text-body-sm text-fg-muted">{t("modelHint")}</p>
        <p className="text-body-sm text-fg-muted">{t("modelHintNote")}</p>
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="text-label text-fg">{t("imagesTitle")}</legend>
        <p className="text-body-sm text-fg-muted">{t("imagesHint")}</p>
        <ul className="grid gap-3">
          {images.map((o) => (
            <li
              key={o.id}
              className="grid items-end gap-2 rounded-md border border-subtle p-3 sm:grid-cols-[1fr_8rem_1fr]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm text-fg">{o.name}</span>
                <ReadyBadge ready={o.ready} label={tp(o.ready ? "configured" : "notConfigured")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rt-img-${o.id}-pos`}>{t("position")}</Label>
                <select
                  id={`rt-img-${o.id}-pos`}
                  name={`image.${o.id}.position`}
                  value={positions[o.id] ?? ""}
                  onChange={(e) => setPositions((p) => ({ ...p, [o.id]: e.target.value }))}
                  className={controlClass}
                >
                  <option value="">{t("off")}</option>
                  {images.map((_, i) => (
                    <option key={i} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <Badge variant={roleVariant(positions[o.id] ?? "")}>
                  {roleLabel(positions[o.id] ?? "")}
                </Badge>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rt-img-${o.id}-model`}>{t("model")}</Label>
                {catalogProviderOf(o.id) ? (
                  <LiveModelField
                    provider={catalogProviderOf(o.id)!}
                    id={`rt-img-${o.id}-model`}
                    name={`image.${o.id}.model`}
                    defaultValue={initial.images.find((x) => x.provider === o.id)?.model ?? ""}
                    placeholder={o.defaultModel}
                  />
                ) : (
                  <Input
                    id={`rt-img-${o.id}-model`}
                    name={`image.${o.id}.model`}
                    defaultValue={initial.images.find((x) => x.provider === o.id)?.model ?? ""}
                    placeholder={o.defaultModel}
                    maxLength={200}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-body-sm text-success">
          {t("saved")}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-fit">
        <Save aria-hidden />
        {tc("actions.save")}
      </Button>
    </form>
  );
}
