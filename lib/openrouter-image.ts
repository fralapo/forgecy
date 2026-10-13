import { ApiFailure } from "./http";

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

export function decodeOpenRouterImage(payload: unknown) {
  const root = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const first = Array.isArray(root.data) && root.data[0] !== null && typeof root.data[0] === "object"
    ? root.data[0] as Record<string, unknown> : {};
  const encoded = first.b64_json;
  const mediaType = first.media_type;
  if (typeof mediaType !== "string" || !(mediaType in IMAGE_TYPES))
    throw new ApiFailure(502, "OpenRouter ha restituito un formato immagine non supportato");
  if (typeof encoded !== "string" || encoded.length === 0)
    throw new ApiFailure(502, "OpenRouter non ha restituito dati immagine validi");
  if (encoded.length > 20_000_000) throw new ApiFailure(413, "Immagine troppo grande");
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new ApiFailure(502, "OpenRouter non ha restituito dati immagine validi");
  const binary = Buffer.from(encoded, "base64");
  if (binary.toString("base64") !== encoded)
    throw new ApiFailure(502, "OpenRouter non ha restituito dati immagine validi");
  if (binary.length === 0) throw new ApiFailure(502, "OpenRouter non ha restituito un'immagine");
  if (binary.length > 15_000_000) throw new ApiFailure(413, "Immagine troppo grande");
  return {
    binary,
    contentType: mediaType as keyof typeof IMAGE_TYPES,
    extension: IMAGE_TYPES[mediaType as keyof typeof IMAGE_TYPES]
  };
}
