"use client";

import type { ByokProviderId } from "@forgecy/ai";
import { Button, Input, Label } from "@forgecy/ui";
import { FlaskConical, KeyRound, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  removeApiKeyAction,
  setApiKeyAction,
  testApiKeyAction,
  type ApiKeyState,
  type ApiKeyTestState,
} from "../actions";

interface Props {
  provider: ByokProviderId;
  connection: { keyHint: string; status: "active" | "disabled" } | null;
}

const providerLinkHref: Record<ByokProviderId, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  openrouter: "https://openrouter.ai/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
};

/** Settings > AI providers: the agency's own API key for one provider, pasted here instead of .env. */
export function ApiKeyForm({ provider, connection }: Props) {
  const t = useTranslations("settings.aiProviders.apiKey");
  const tp = useTranslations(`settings.aiProviders.apiKey.providers.${provider}`);
  const [saveState, saveAction, saving] = useActionState<ApiKeyState, FormData>(
    setApiKeyAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<ApiKeyTestState, FormData>(
    testApiKeyAction,
    {},
  );

  return (
    <div className="grid gap-3 rounded-md border border-subtle p-4">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="size-4 text-fg-muted" strokeWidth={1.5} />
        <p className="text-body-sm text-fg">{t("title", { name: tp("name") })}</p>
      </div>
      <p className="text-body-sm text-fg-muted">
        {tp("hint")}{" "}
        <a
          href={providerLinkHref[provider]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-link underline"
        >
          {tp("link")}
        </a>
      </p>
      {connection ? (
        <p className="font-mono text-body-sm text-fg">
          {t("current", { hint: connection.keyHint })}
        </p>
      ) : null}
      <form action={saveAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="provider" value={provider} />
        <div className="grid gap-1">
          <Label htmlFor={`${provider}-api-key`}>{t("label")}</Label>
          <Input
            id={`${provider}-api-key`}
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={tp("placeholder")}
            className="w-72"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={saving}>
          {t("save")}
        </Button>
        <Button type="submit" variant="ghost" formAction={testAction} disabled={testing}>
          <FlaskConical aria-hidden />
          {t("test")}
        </Button>
        {connection ? (
          <Button type="submit" variant="ghost" formAction={removeApiKeyAction}>
            <Trash2 aria-hidden />
            {t("remove")}
          </Button>
        ) : null}
      </form>
      {saveState.ok ? (
        <p role="status" className="text-body-sm text-success">
          {t("saved")}
        </p>
      ) : null}
      {saveState.error ? (
        <p role="alert" className="text-body-sm text-error">
          {saveState.error}
        </p>
      ) : null}
      {testState.tested ? (
        <p
          role={testState.ok ? "status" : "alert"}
          className={`text-body-sm ${testState.ok ? "text-success" : "text-error"}`}
        >
          {testState.ok ? t("testOk") : t("testFailed", { error: testState.error ?? "" })}
        </p>
      ) : null}
    </div>
  );
}
