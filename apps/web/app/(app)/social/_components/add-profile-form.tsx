"use client";

import type { SocialProfileRole } from "@forgecy/core";
import { Button, Card, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { controlClass } from "../../content/_components/action-button";
import { addProfileAction } from "../actions";

const ROLES: readonly SocialProfileRole[] = ["self", "competitor", "prospect"];

/** The one thing needed to start: a profile link or @name and who it is. It is read right away. */
export function AddProfileForm({
  slug,
  defaultRole,
}: {
  slug: string;
  defaultRole: SocialProfileRole;
}) {
  const t = useTranslations("social");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<SocialProfileRole>(defaultRole);
  return (
    <Card className="mb-6 p-6">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await addProfileAction(slug, { handle, role });
            if (!r.ok) setError(r.error);
            else {
              setHandle("");
              // Only one profile is the client's own: the next one is a competitor.
              if (role === "self") setRole("competitor");
            }
            router.refresh();
          });
        }}
      >
        <h2 className="text-heading-sm text-fg">{t("add.title")}</h2>
        <p className="text-body-sm text-fg-muted">{t("add.description")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-64 flex-1 gap-1">
            <Label htmlFor="social-handle">{t("add.handleLabel")}</Label>
            <Input
              id="social-handle"
              name="handle"
              required
              maxLength={300}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder={t("add.handlePlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="social-role">{t("add.roleLabel")}</Label>
            <select
              id="social-role"
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as SocialProfileRole)}
              className={`${controlClass} h-10`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending}>
            <Plus aria-hidden />
            {pending ? t("add.adding") : t("add.submit")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
