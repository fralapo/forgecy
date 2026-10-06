"use client";

import { Button, Label } from "@forgecy/ui";
import { Check, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { decideAssetAction, updateAltAction } from "../actions";
import { controlClass } from "./action-button";

interface AssetRef {
  slug: string;
  clientId: string;
  id: string;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const exec = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      done?.();
      router.refresh();
    });
  return { pending, error, exec };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-body-sm text-error">
      {error}
    </p>
  ) : null;
}

/** Editable alt text of a library image. */
export function LibraryAltForm({ alt, ...ref }: AssetRef & { alt: string }) {
  const [value, setValue] = useState(alt);
  const t = useTranslations("content.library.asset");
  const { pending, error, exec } = useRun();
  const fieldId = `alt-${ref.id}`;
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => updateAltAction({ ...ref, alt: value }));
      }}
    >
      <Label htmlFor={fieldId}>{t("alt")}</Label>
      <textarea
        id={fieldId}
        rows={2}
        maxLength={300}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={controlClass}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || value === alt}>
        <Save aria-hidden />
        {t("save")}
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

/** “Approve” / “Reject” of a draft image; rejecting asks for the reason. */
export function LibraryDecision(ref: AssetRef) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const t = useTranslations("content.library.asset");
  const { pending, error, exec } = useRun();
  const fieldId = `reason-${ref.id}`;
  return (
    <div className="space-y-2">
      {rejecting ? (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            exec(
              () => decideAssetAction({ ...ref, decision: "rejected", reason }),
              () => setRejecting(false),
            );
          }}
        >
          <Label htmlFor={fieldId}>{t("rejectReason")}</Label>
          <textarea
            id={fieldId}
            rows={2}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={controlClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              <X aria-hidden />
              {t("reject")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => exec(() => decideAssetAction({ ...ref, decision: "approved" }))}
          >
            <Check aria-hidden />
            {t("approve")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => setRejecting(true)}
          >
            <X aria-hidden />
            {t("reject")}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
