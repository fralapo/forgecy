"use client";

import { Button, Label } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { decideDirectionAction, proposeDirectionAction, type ActionResult } from "../actions";
import { controlClass } from "./action-button";

interface Ref {
  slug: string;
  clientId: string;
  contentId: string;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };
  return { pending, error, run };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className="text-body-sm text-error">
      {error}
    </span>
  ) : null;
}

/** “Propose a direction”: an optional instruction for the Creative Director. */
export function DirectionPropose({
  refs,
  hasDirection,
  disabled,
}: {
  refs: Ref;
  hasDirection: boolean;
  disabled: boolean;
}) {
  const { pending, error, run } = useRun();
  const t = useTranslations("content.direction.form");
  const [instruction, setInstruction] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            proposeDirectionAction({
              slug: refs.slug,
              clientId: refs.clientId,
              id: refs.contentId,
              instruction,
            }),
          () => setInstruction(""),
        );
      }}
    >
      <Label htmlFor="cd-instruction">{t("instruction")}</Label>
      <textarea
        id="cd-instruction"
        rows={2}
        maxLength={500}
        className={controlClass}
        value={instruction}
        disabled={disabled || pending}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t("instructionPlaceholder")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={disabled || pending}>
          <Sparkles aria-hidden />
          {hasDirection ? t("again") : t("propose")}
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

/** Accept or reject an open proposal; rejecting asks why. */
export function DirectionDecision({
  refs,
  directionId,
  disabled,
}: {
  refs: Ref;
  directionId: string;
  disabled: boolean;
}) {
  const { pending, error, run } = useRun();
  const t = useTranslations("content.direction");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const base = { slug: refs.slug, clientId: refs.clientId, id: refs.contentId, directionId };
  if (rejecting)
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => decideDirectionAction({ ...base, decision: "reject", reason }));
        }}
      >
        <Label htmlFor={`cd-reason-${directionId}`}>{t("rejectReason")}</Label>
        <textarea
          id={`cd-reason-${directionId}`}
          rows={2}
          maxLength={500}
          required
          className={controlClass}
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("rejectPlaceholder")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !reason.trim()}>
            {t("confirmReject")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setRejecting(false)}
          >
            {t("cancel")}
          </Button>
          <ErrorText error={error} />
        </div>
      </form>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={disabled || pending}
        onClick={() => run(() => decideDirectionAction({ ...base, decision: "accept" }))}
      >
        {t("accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || pending}
        onClick={() => setRejecting(true)}
      >
        {t("reject")}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
