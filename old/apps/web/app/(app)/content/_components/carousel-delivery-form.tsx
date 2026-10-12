"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { markPublishedAction, setStockCreditsAction } from "../actions";
import { controlClass } from "./action-button";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Delivery record: stock credits (feed the caption check and the manifest) and “Mark as published”. */
export function CarouselDeliveryForm({
  slug,
  clientId,
  contentId,
  canPublish,
  stockCredits,
  published,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  canPublish: boolean;
  stockCredits: string[];
  published: {
    at: string;
    externalId: string | null;
    externalUrl: string | null;
    version: number | null;
    errors: number;
    warnings: number;
  } | null;
}) {
  const t = useTranslations("content.export.delivery");
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [credits, setCredits] = useState(stockCredits.join("\n"));
  const [externalUrl, setExternalUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const ref = { slug, clientId, id: contentId };

  if (published)
    return (
      <div className="grid gap-2 text-body-sm text-fg">
        <p role="status">{t("publishedOn", { date: published.at })}</p>
        {published.version ? <p>{t("deliveredVersion", { number: published.version })}</p> : null}
        <p>{t("gates", { errors: published.errors, warnings: published.warnings })}</p>
        {published.externalUrl ? (
          <p>
            <a href={published.externalUrl} rel="noreferrer noopener" target="_blank">
              {published.externalUrl}
            </a>
          </p>
        ) : null}
        {published.externalId ? <p>{t("externalIdValue", { id: published.externalId })}</p> : null}
        {stockCredits.length ? (
          <ul>
            {stockCredits.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );

  const run = (fn: () => ReturnType<typeof setStockCreditsAction>, done: string) => {
    setMessage(null);
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { error: false, text: done } : { error: true, text: r.error });
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Label htmlFor={`${id}-credits`}>{t("credits")}</Label>
        <textarea
          id={`${id}-credits`}
          rows={3}
          className={controlClass}
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
        />
        <p className="text-body-sm text-fg-muted">{t("creditsHint")}</p>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(
                () => setStockCreditsAction({ ...ref, stockCredits: lines(credits) }),
                t("creditsSaved"),
              )
            }
          >
            {t("saveCredits")}
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-url`}>{t("externalUrl")}</Label>
        <Input
          id={`${id}-url`}
          type="url"
          maxLength={1000}
          value={externalUrl}
          onChange={(e) => setExternalUrl(e.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-ext`}>{t("externalId")}</Label>
        <Input
          id={`${id}-ext`}
          maxLength={200}
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending || !canPublish}
          onClick={() => {
            if (!window.confirm(t("confirm"))) return;
            run(
              () =>
                markPublishedAction({
                  ...ref,
                  stockCredits: lines(credits),
                  ...(externalUrl ? { externalUrl } : {}),
                  ...(externalId ? { externalId } : {}),
                }),
              t("done"),
            );
          }}
        >
          <CheckCheck aria-hidden />
          {t("publish")}
        </Button>
        {!canPublish ? (
          <span className="text-body-sm text-fg-muted">{t("needsApproval")}</span>
        ) : null}
        {message ? (
          <span
            role={message.error ? "alert" : "status"}
            className={message.error ? "text-body-sm text-error" : "text-body-sm text-fg-muted"}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
