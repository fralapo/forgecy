import { MAX_ARCHIVE_BYTES, restoreWorkspaceArchive, WorkspaceArchiveValidationError } from "@/lib/sync/archive";
import { ApiFailure, fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const rawLength = request.headers.get("content-length");
    if (rawLength !== null) {
      const length = Number(rawLength);
      if (!Number.isSafeInteger(length) || length < 0) throw new ApiFailure(400, "Dimensione richiesta non valida");
      if (length > MAX_ARCHIVE_BYTES) throw new ApiFailure(413, "Archivio troppo grande (massimo 250 MB)");
    }
    if (!request.body) throw new ApiFailure(400, "Seleziona un archivio Forgecy");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ARCHIVE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new ApiFailure(413, "Archivio troppo grande (massimo 250 MB)");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!size) throw new ApiFailure(400, "Seleziona un archivio Forgecy");
    let restored;
    try { restored = await restoreWorkspaceArchive(bytes); }
    catch (error) {
      if (error instanceof WorkspaceArchiveValidationError) {
        throw new ApiFailure(400, "L’archivio Forgecy non è valido o è danneggiato");
      }
      throw error;
    }
    return json({ restored: true, hash: restored.hash, backup: restored.backup, message: "Workspace importato. Forgecy ha conservato una copia locale precedente, se presente." });
  } catch (error) { return fail(error); }
}
