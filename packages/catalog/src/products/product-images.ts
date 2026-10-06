import { assertCan, ForgecyError } from "@forgecy/core";
import { recordAuditEvent, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import type { ActingUser } from "../db";
import { attachImages, loadProduct } from "./products";
import { sniffFile } from "../parsers/sniff";
import { storeTempFile, type TempFile } from "../storage";

/** “Add image” on the product page: a photo uploaded by a person, kept as a draft asset. */
export async function addProductImage(
  db: Database,
  storage: StorageDriver,
  user: ActingUser,
  input: { clientId: string; productId: string; fileName: string; temp: TempFile },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const product = await loadProduct(db, input.clientId, input.productId);
  const sniff = sniffFile(input.fileName, input.temp.size, input.temp.head);
  if (!sniff.ok || sniff.kind !== "image")
    throw new ForgecyError("validation", sniff.message ?? "Upload a PNG, JPG or WebP image.");
  const key = await storeTempFile(storage, {
    clientId: input.clientId,
    temp: input.temp,
    ext: sniff.ext!,
    mime: sniff.mime!,
  });
  await db.transaction(async (tx) => {
    const added = await attachImages(tx, {
      clientId: input.clientId,
      productId: product.id,
      images: [
        {
          storageKey: key,
          sha256: input.temp.sha256,
          mime: sniff.mime!,
          fileName: input.fileName,
          matchMethod: "manual",
          confidence: "high",
        },
      ],
      createdBy: user.id,
    });
    if (added === 0)
      throw new ForgecyError("conflict", "This image is already linked to the product.");
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.image_add",
      entity: "product",
      entityId: product.id,
      clientId: input.clientId,
      meta: { fileName: input.fileName.slice(0, 200) },
    });
  });
}
