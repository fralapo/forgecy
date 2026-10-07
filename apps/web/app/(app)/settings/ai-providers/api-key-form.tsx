"use client";

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
  connection: { keyHint: string; status: "active" | "disabled" } | null;
}

/** Settings > AI providers: the agency's own OpenAI API key, pasted here instead of .env. */
export function ApiKeyForm({ connection }: Props) {
  const t = useTranslations("settings.aiProviders.apiKey");
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
        <p className="text-body-sm text-fg">{t("title")}</p>
      </div>
      <p className="text-body-sm text-fg-muted">
        {t("hint")}{" "}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer noopener"
          className="text-link underline"
        >
          {t("link")}
        </a>
      </p>
      {connection ? (
        <p className="font-mono text-body-sm text-fg">
          {t("current", { hint: connection.keyHint })}
        </p>
      ) : null}
      <form action={saveAction} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="openai-api-key">{t("label")}</Label>
          <Input
            id="openai-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={t("placeholder")}
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
