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
 * fallback) and the primary/fallback image providers. Unconfigured providers can be
 * chosen too; they are skipped until their key or connection exists. Image choice
 * mirrors the text one (primary + fallback blocks) since only the first two ready
 * image providers are ever tried — a third or fourth choice has no effect.
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
  const [primaryImage, setPrimaryImage] = useState(initial.images[0]?.provider ?? "");
  const [secondaryImage, setSecondaryImage] = useState(initial.images[1]?.provider ?? "");
  const label = (o: ProviderOption) => (o.ready ? o.name : t("notReady", { name: o.name }));
  const textDefault = (id: string | undefined) => text.find((o) => o.id === id)?.defaultModel ?? "";
  const imageDefault = (id: string | undefined) =>
    images.find((o) => o.id === id)?.defaultModel ?? "";
  const selectedText = text.find((o) => o.id === textProvider);
  const selectedFallback = text.find((o) => o.id === fallbackProvider);
  const selectedPrimaryImage = images.find((o) => o.id === primaryImage);
  const selectedSecondaryImage = images.find((o) => o.id === secondaryImage);

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
                  kind="text"
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
                  kind="text"
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-3 rounded-md border border-subtle p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-fg">{ta("primary")}</span>
              {selectedPrimaryImage ? (
                <ReadyBadge
                  ready={selectedPrimaryImage.ready}
                  label={tp(selectedPrimaryImage.ready ? "configured" : "notConfigured")}
                />
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-img-primary-provider">{t("provider")}</Label>
              <select
                id="rt-img-primary-provider"
                value={primaryImage}
                onChange={(e) => setPrimaryImage(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("none")}</option>
                {images.map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-img-primary-model">{t("model")}</Label>
              {primaryImage && catalogProviderOf(primaryImage) ? (
                <LiveModelField
                  provider={catalogProviderOf(primaryImage)!}
                  kind="image"
                  id="rt-img-primary-model"
                  name={`image.${primaryImage}.model`}
                  defaultValue={initial.images[0]?.model ?? ""}
                  placeholder={imageDefault(primaryImage)}
                />
              ) : (
                <Input
                  id="rt-img-primary-model"
                  name={primaryImage ? `image.${primaryImage}.model` : undefined}
                  disabled={!primaryImage}
                  defaultValue={initial.images[0]?.model ?? ""}
                  placeholder={imageDefault(primaryImage)}
                  maxLength={200}
                />
              )}
            </div>
            {primaryImage ? (
              <input type="hidden" name={`image.${primaryImage}.position`} value="1" />
            ) : null}
          </div>
          <div className="grid gap-3 rounded-md border border-subtle p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-fg-muted">{ta("secondary")}</span>
              {selectedSecondaryImage ? (
                <ReadyBadge
                  ready={selectedSecondaryImage.ready}
                  label={tp(selectedSecondaryImage.ready ? "configured" : "notConfigured")}
                />
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-img-secondary-provider">{t("provider")}</Label>
              <select
                id="rt-img-secondary-provider"
                value={secondaryImage}
                onChange={(e) => setSecondaryImage(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("none")}</option>
                {images
                  .filter((o) => o.id !== primaryImage)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {label(o)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rt-img-secondary-model">{t("model")}</Label>
              {secondaryImage && catalogProviderOf(secondaryImage) ? (
                <LiveModelField
                  provider={catalogProviderOf(secondaryImage)!}
                  kind="image"
                  id="rt-img-secondary-model"
                  name={`image.${secondaryImage}.model`}
                  defaultValue={initial.images[1]?.model ?? ""}
                  placeholder={imageDefault(secondaryImage)}
                />
              ) : (
                <Input
                  id="rt-img-secondary-model"
                  name={secondaryImage ? `image.${secondaryImage}.model` : undefined}
                  disabled={!secondaryImage}
                  defaultValue={initial.images[1]?.model ?? ""}
                  placeholder={imageDefault(secondaryImage)}
                  maxLength={200}
                />
              )}
            </div>
            {secondaryImage ? (
              <input type="hidden" name={`image.${secondaryImage}.position`} value="2" />
            ) : null}
          </div>
        </div>
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
