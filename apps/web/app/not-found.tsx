import { Card } from "@forgecy/ui";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("errors.notFoundPage");
  return { title: t("title") };
}

/** 404 in the reader's language (Next.js would show its English default). */
export default async function NotFound() {
  const t = await getTranslations("errors.notFoundPage");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <FileQuestion aria-hidden className="size-8 text-fg-muted" />
        <h1 className="mt-4 text-heading-sm text-fg">{t("title")}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t("body")}</p>
        <Link href="/" className="mt-6 inline-block text-body-sm text-fg underline">
          {t("home")}
        </Link>
      </Card>
    </main>
  );
}
