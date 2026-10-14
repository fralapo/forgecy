export type DocumentImage = {
  dataUrl: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
  origin?: "openrouter-ocr" | "native-pdf";
  pageNumber?: number;
  candidateProductNames?: string[];
};
