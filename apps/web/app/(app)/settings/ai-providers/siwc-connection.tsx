"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { LogIn, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  connectSiwcAction,
  disconnectSiwcAction,
  setSiwcClientIdAction,
  type SiwcClientIdState,
  type SiwcConnectState,
} from "../actions";

interface Props {
  configured: boolean;
  isAdmin: boolean;
  connection: {
    status: "pending" | "connected" | "error";
    planSharing: boolean;
    name: string | null;
    email: string | null;
    lastError: string | null;
  } | null;
}

/** Settings > AI providers: connect the signed-in person's own ChatGPT account. */
export function SiwcConnection({ configured, isAdmin, connection }: Props) {
  const t = useTranslations("settings.aiProviders.siwc");
  const [connectState, connectAction, connecting] = useActionState<SiwcConnectState, FormData>(
    connectSiwcAction,
    {},
  );
  const [clientIdState, saveClientId, savingClientId] = useActionState<SiwcClientIdState, FormData>(
    setSiwcClientIdAction,
    {},
  );

  if (!configured) {
    return (
      <div className="grid gap-3 rounded-md border border-subtle p-4">
        <p className="text-body-sm text-fg">{t("notConfigured.title")}</p>
        <p className="text-body-sm text-fg-muted">{t("notConfigured.description")}</p>
        {isAdmin ? (
          <form action={saveClientId} className="flex flex-wrap items-end gap-2 pt-2">
            <div className="grid gap-1">
              <Label htmlFor="siwc-client-id">{t("adminClientId.label")}</Label>
              <Input
                id="siwc-client-id"
                name="clientId"
                placeholder={t("adminClientId.placeholder")}
                className="w-64"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={savingClientId}>
              {t("adminClientId.save")}
            </Button>
            {clientIdState.ok ? (
              <p role="status" className="w-full text-body-sm text-success">
                {t("adminClientId.saved")}
              </p>
            ) : null}
            {clientIdState.error ? (
              <p role="alert" className="w-full text-body-sm text-error">
                {clientIdState.error}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-subtle p-4">
      <p className="text-body-sm text-fg-muted">{t("description")}</p>
      <p className="text-body-sm text-fg-muted">
        {t(connection?.planSharing ? "planSharing.active" : "planSharing.pending")}
      </p>
      {connection?.status === "connected" ? (
        <>
          <p className="text-body-sm text-fg">
            {t("connectedAs", { name: connection.name ?? "", email: connection.email ?? "" })}
          </p>
          <form action={disconnectSiwcAction}>
            <Button type="submit" variant="secondary">
              <Unlink aria-hidden />
              {t("disconnect")}
            </Button>
          </form>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={connectAction}>
            <Button type="submit" disabled={connecting}>
              <LogIn aria-hidden />
              {t("connect")}
            </Button>
          </form>
          {connection?.lastError ? (
            <p role="alert" className="w-full text-body-sm text-error">
              {t("lastError")}: {connection.lastError}
            </p>
          ) : null}
        </div>
      )}
      {connectState.error ? (
        <p role="alert" className="text-body-sm text-error">
          {connectState.error}
        </p>
      ) : null}
    </div>
  );
}
