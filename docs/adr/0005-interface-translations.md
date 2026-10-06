# 0005 · Interface text from message files with next-intl

- Status: accepted
- Date: 2026-10-06

## Context

The interface text was written in English directly in the components and in label maps, and dates were formatted with a fixed `en-GB` locale. The agency wants Italian too, and more languages later, without duplicating pages and with one place to change a wording.

## Decision

- **next-intl** (MIT, the most used i18n library for the Next.js App Router, works in server and client components) without locale routing: URLs stay the same, the language is resolved per request.
- **Language**: the person's preference (`users.locale`, null = automatic), otherwise the browser's `Accept-Language`, otherwise English. English is the source and fallback language.
- **Messages** in `packages/i18n/messages/<locale>/<namespace>.json` (ICU syntax), shared by the web app, the worker and emails. A key missing from a translation falls back to English at runtime.
- **Checks**: keys typed from the English files; tests for missing or extra keys, ICU syntax and variables; the `forgecy/no-hardcoded-text` lint rule for JSX.
- **Domain errors** carry a message reference (`ForgecyError.ref`, built with `localizedError`) next to the English message.
- **Interface language and deliverable language are separate**: client deliverables keep the language chosen per audit or content.

## Consequences

Every new page writes its text in `messages/en` and `messages/it`. Adding a language is a new folder plus three one-line additions. All messages are sent to the browser for client components; with a few hundred kilobytes at most this is acceptable for an internal tool and can be narrowed per namespace later.
