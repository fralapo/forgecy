"""Small JSON-lines adapter for Forgecy's isolated PaddleOCR-VL runtime."""
from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path


def text_values(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            result.extend(text_values(item))
        return result
    if isinstance(value, dict):
        for key in ("markdown_texts", "text", "content"):
            if key in value:
                return text_values(value[key])
    return []


def parse_document(path: Path):
    # Paddle's progress and model initialization output must not corrupt the JSON response.
    with contextlib.redirect_stdout(sys.stderr):
        from paddleocr import PaddleOCRVL

        pipeline = PaddleOCRVL(device="cpu")
        results = list(pipeline.predict(input=str(path)))
    text_pages = []
    image_blobs = []
    image_bytes = 0
    for result in results:
        markdown = getattr(result, "markdown", None)
        if callable(markdown):
            markdown = markdown()
        if not isinstance(markdown, dict):
            markdown = {}
        page_text = "\n".join(piece.strip() for piece in text_values(markdown) if piece.strip())
        if page_text:
            text_pages.append(page_text[:80_000])
        images = markdown.get("markdown_images", {})
        if isinstance(images, dict):
            for image in images.values():
                if len(image_blobs) >= 8:
                    break
                try:
                    buffer = io.BytesIO()
                    image.save(buffer, format="PNG")
                    raw = buffer.getvalue()
                    if raw and len(raw) <= 5_000_000 and image_bytes + len(raw) <= 10_000_000:
                        image_blobs.append({"mime": "image/png", "base64": base64.b64encode(raw).decode("ascii")})
                        image_bytes += len(raw)
                except Exception:
                    continue
    return {"text": "\n\n".join(text_pages)[:80_000], "pageCount": len(results) or 1, "images": image_blobs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        from PIL import Image, ImageDraw, ImageFont

        with tempfile.TemporaryDirectory(prefix="forgecy-ocr-check-") as tmp:
            image_path = Path(tmp) / "smoke-test.png"
            image = Image.new("RGB", (1500, 420), "white")
            draw = ImageDraw.Draw(image)
            draw.text((60, 130), "FORGECY LOCAL OCR TEST", fill="black", font=ImageFont.load_default(size=72))
            image.save(image_path)
            output = parse_document(image_path)
        if "FORGECY" not in output["text"].upper():
            raise RuntimeError("OCR smoke test did not recognize its test text")
    else:
        if not args.input or not args.input.is_file():
            raise SystemExit("missing input document")
        output = parse_document(args.input)
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
