# 0011 · Template texts in the interface language

- Status: accepted
- Date: 2026-10-07

## Context

A template's name, description, notes, layout names and slot labels come from its `template.json` and are written in English. The Italian interface showed them in English (or bilingual, "Cover · Copertina"), in the catalog, the carousel editor, the outline and the forms. The printed labels in `locales/` cannot serve here: they follow the deliverable's language, these texts follow the reader's interface language.

## Decision

- A template package may ship `interface/<code>.json` for every language other than English, with only the texts it translates: `name`, `description`, `notes`, and `layouts.<id>.name` / `layouts.<id>.slots.<slot>`. English stays in `template.json` and is the fallback for every missing text.
- When a package is read (folder, ZIP or storage), the files are stored in the manifest under `translations`, so pages read them from the database row without opening the package. Ids, slot names and limits are never translated.
- Pages localize at the boundary (`localizeManifest`, `getManifestLocalizer` in the web app). AI agents, checks stored in the database and exports keep the English manifest.
- Templates imported before this change, or without the files, show English. The built-in templates got a patch version so they can be imported again with Italian.

## Consequences

Adding an interface language means one more `interface/<code>.json` per template; the carousel tests fail when a built-in template misses a layout or slot in Italian or names one that does not exist.
