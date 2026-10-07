"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { saveRoutingAction, type RoutingState } from "../actions";
import { controlClass } from "../../content/_components/action-button";
import { OpenRouterModelField } from "./openrouter-model-field";

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
  const tc = useTranslations("common");
  const [textProvider, setTextProvider] = useState(initial.text.provider);
  const [fallbackProvider, setFallbackProvider] = useState(initial.text.fallback?.provider ?? "");
  const label = (o: ProviderOption) => (o.ready ? o.name : t("notReady", { name: o.name }));
  const textDefault = (id: string | undefined) => text.find((o) => o.id === id)?.defaultModel ?? "";
  const position = (id: string) => {
    const i = initial.images.findIndex((x) => x.provider === id);
    return i < 0 ? "" : String(i + 1);
  };
  return (
    <form action={action} className="grid gap-6">
      <fieldset className="grid gap-4">
        <legend className="text-label text-fg">{t("textTitle")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
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
            {textProvider === "openrouter" ? (
              <OpenRouterModelField
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
            {fallbackProvider === "openrouter" ? (
              <OpenRouterModelField
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
        <p className="text-body-sm text-fg-muted">{t("modelHint")}</p>
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="text-label text-fg">{t("imagesTitle")}</legend>
        <p className="text-body-sm text-fg-muted">{t("imagesHint")}</p>
        <ul className="grid gap-3">
          {images.map((o) => (
            <li key={o.id} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_1fr]">
              <span className="text-body-sm text-fg">{label(o)}</span>
              <div className="grid gap-1">
                <Label htmlFor={`rt-img-${o.id}-pos`}>{t("position")}</Label>
                <select
                  id={`rt-img-${o.id}-pos`}
                  name={`image.${o.id}.position`}
                  defaultValue={position(o.id)}
                  className={controlClass}
                >
                  <option value="">{t("off")}</option>
                  {images.map((_, i) => (
                    <option key={i} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rt-img-${o.id}-model`}>{t("model")}</Label>
                {o.id === "openrouter" ? (
                  <OpenRouterModelField
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
