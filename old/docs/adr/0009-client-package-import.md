# 0009 · How a client package is imported

- Status: accepted
- Date: 2026-10-06
- Amended by: 0015 (what an imported row may claim; template reuse)

## Context

Page 68 of the UX specification asks for a full client import with a conflict preview, a backup before a replacement, and no partial data after a failure. Two of its conflict rows do not fit the data model: assets are unique per client (`assets_client_sha_uq`), so an imported client never shares an asset with another one, and people are foreign keys to `users`, so a name kept "as text" has no column to live in.

## Decision

- The package is a generic dump of every client table, found from the Drizzle schema by following the foreign keys. On import every row gets a new id; ids written anywhere in a row (JSON, storage keys such as `clients/<id>/…`) are rewritten with the same map. Rows go in one transaction, in foreign-key order, with forward nullable keys (contents ↔ content_versions) set in a second pass. Files are copied first and deleted again if the transaction fails.
- People are matched by email. A person who is not here leaves the reference empty; a row that needs a person (an approval, a dismissed Brand Guard issue) is left out, so nothing looks approved by someone who does not exist. The Conflicts step lists both cases as resolved automatically.
- Asset conflicts are not offered: assets are always imported as the new client's own copies.
- Templates: same key and version already here → reused. Same key, other version → the person chooses "use the version already here" (the client's carousels point to the newest version here) or "import as a new version in Draft". _(Amended by 0015: only agency templates and the replaced client's own are reused, another client's private template is never mapped in, and a version it holds is renamed.)_
- "Replace the existing client" keeps the client's id and address: the worker makes a backup (`pre_import`), deletes the client (cascade) and writes the package under the same id; the client's own templates stay assigned to it. The typed name is checked in the service.
- A package from a newer schema (more migrations than installed) is blocked; one from an older schema is accepted and missing columns get their defaults.
- Carousels in review go back to Draft. The activity CSV is not imported back. _(Amended by 0015: carousels, audit reports and Brand Book exports arrive as Drafts, images as unapproved drafts, approved products as proposed, templates as Drafts of the client, audits go back to review (delivered ones are archived), approved or published Brand Identity versions are archived and automations are paused; approvals, export records and Brand Guard runs are not imported. Some statuses are kept on purpose, such as strategy, competitor and product image status: 0015 lists them.)_

## Consequences

The import keeps working as new client tables arrive, as long as each one has an area in `TABLE_AREAS` (a test fails otherwise). Files of a replaced client that the package does not carry stay in storage until a cleanup removes them.
