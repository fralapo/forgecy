"use client";

import type { McpImageProviderId } from "@forgecy/ai";
import { Button } from "@forgecy/ui";
import { Link2, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { connectMcpAction, disconnectMcpAction, type McpConnectState } from "../actions";

/** Connect (OAuth login on the provider's site) or disconnect a subscription reached over MCP. */
export function McpConnection({
  provider,
  connected,
}: {
  provider: McpImageProviderId;
  connected: boolean;
}) {
  const [state, action, pending] = useActionState<McpConnectState, FormData>(connectMcpAction, {});
  const t = useTranslations("settings.aiProviders.mcp");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action}>
        <input type="hidden" name="provider" value={provider} />
        <Button type="submit" disabled={pending}>
          <Link2 aria-hidden />
          {t(connected ? "reconnect" : "connect")}
        </Button>
      </form>
      {connected ? (
        <form action={disconnectMcpAction}>
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" variant="secondary">
            <Unlink aria-hidden />
            {t("disconnect")}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="w-full text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
