import { Card } from "@forgecy/ui";
import type { ReactNode } from "react";

/** Centered card used by the sign-in and first-run pages. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <p className="font-display text-heading-md text-fg">Forgecy</p>
        <h1 className="mt-6 text-heading-sm text-fg">{title}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{description}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </main>
  );
}
