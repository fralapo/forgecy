import { Button, Card } from "@forgecy/ui";
import { Package } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "../_components/ui";

/** UXA-P6-05: the catalog exists only for clients, not prospects. */
export function NotAClient({ name }: { name: string }) {
  return (
    <>
      <PageHeader title="Products" description={name} />
      <Card className="p-0">
        <EmptyState
          icon={Package}
          actions={
            <Button asChild variant="secondary">
              <Link href="/clients">Back to prospect</Link>
            </Button>
          }
        >
          The product catalog becomes available once the prospect is converted into a client.
        </EmptyState>
      </Card>
    </>
  );
}
