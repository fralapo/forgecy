# @forgecy/catalog

Product catalog of a client (spec pages 71–74, Flow L): products with descriptions,
technical sheet and reusable photos, built by hand or from a **mixed import** and always
reviewed by a person before anything is approved.

## What it does

- **Mixed import, one screen.** CSV/XLSX (WooCommerce export recognized and mapped),
  ZIP or folders of photos and texts (TXT, DOCX), loose images and PDFs. Each file is
  recognized from its content (magic bytes + extension), validated against the limits and
  given a proposed path (`map`, `match`, `extract`, `source`, `ignore`) the person can change.
- **AI with mandatory review.** With an AI-allowing policy the Brand Analyst proposes the
  column mapping, extracts products from PDFs (with the page of every field) and suggests
  image matches. Everything lands as `proposed` items in the review (page 74). With `no_ai`,
  or `local_only` without a local model, the import falls back to manual mapping, matching
  by folder/file name/SKU and PDFs kept as sources.
- **Review, never silent overwrites.** Duplicates (SKU, then name + category), conflicts
  with approved values decided field by field, sensitive claims (health, environmental,
  certifications, warranties) accepted one by one, bulk approval that excludes them.
- **Price** is optional: kept only when it is in the file, normalized, never invented, no
  dedicated approval.

## Security

- Zip-bomb limits: entries, declared and actual uncompressed size, per-entry ratio
  (`limits.ts`, `zip.ts`); path traversal, symlinks and encrypted entries are refused.
  XLSX/DOCX go through the same guard before parsing.
- Uploads are streamed to a private temp file with a hard size cap; disk full → `DISK-FULL`.
- PDF, sheet and text content is **data**: prompts wrap it in `<document>`/`<files>` and
  tell the model never to follow instructions found there (`ai.ts`).
- CSV export neutralizes spreadsheet formulas.
- Agents can only propose: approve, review and archive are not agent permissions.

## Layout

| Folder      | Files                                                                                                                            | Role                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `products/` | `fields.ts`, `meta.ts`, `sensitive.ts`, `completeness.ts`, `products.ts`, `product-images.ts`, `queries.ts`, `csv-export.ts`     | Product fields, provenance/truth level, claim detection, product operations, page queries, CSV export          |
| `parsers/`  | `sniff.ts`, `inspect.ts`, `zip.ts`, `sheet.ts`, `pdf.ts`, `documents.ts`, `text.ts`                                              | File recognition and readers                                                                                   |
| `import/`   | `imports.ts`, `pipeline.ts`, `jobs.ts`, `mapping.ts`, `candidates.ts`, `review.ts`, `ai.ts`, `cost.ts`, `errors.ts`, `limits.ts` | Import lifecycle, column mapping (WooCommerce preset), merging, review decisions, AI prompts and cost estimate |
| `src/` root | `index.ts`, `handlers.ts`, `db.ts`, `storage.ts`                                                                                 | Public entry point, worker handlers (`catalog.import_analyze`), shared handles                                 |

The worker registers `catalogHandlers` from `@forgecy/catalog/handlers`; the web pages
live in `apps/web/app/(app)/products`.

## Tests

`pnpm --filter @forgecy/catalog test`. The integration test (full import with a fake AI
provider, and a `no_ai` client) runs when `FORGECY_TEST_DATABASE_URL` is set.
