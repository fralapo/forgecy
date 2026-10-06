import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-body-md text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
