"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { LogIn, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

/** Only same-site relative paths are accepted as post-login destinations. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm({ magicLink, google }: { magicLink: boolean; google: boolean }) {
  const router = useRouter();
  const t = useTranslations("auth.login");
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? t("tooManyAttempts") : t("wrongCredentials"));
      return;
    }
    router.replace(safeNext(params.get("next")) as never);
    router.refresh();
  }

  async function onMagicLink(email: string) {
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: safeNext(params.get("next")),
    });
    setPending(false);
    if (error) setError(t("magicLinkFailed"));
    else setNotice(t("magicLinkSent"));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onPassword} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-body-sm text-success">
            {notice}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          <LogIn aria-hidden />
          {t("submit")}
        </Button>
      </form>
      {magicLink ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() => {
            const email =
              (document.getElementById("email") as HTMLInputElement | null)?.value ?? "";
            if (!email) setError(t("magicLinkNeedsEmail"));
            else void onMagicLink(email);
          }}
        >
          <Mail aria-hidden />
          {t("magicLink")}
        </Button>
      ) : null}
      {google ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() =>
            void authClient.signIn.social({
              provider: "google",
              callbackURL: safeNext(params.get("next")),
            })
          }
        >
          {t("google")}
        </Button>
      ) : null}
    </div>
  );
}
