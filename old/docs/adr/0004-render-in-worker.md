# 0004 · The worker renders slides in process, without going through the /render route

- Status: accepted (M3)
- Date: 2026-10-06

## Context

The specification describes export like this: the worker opens the web app's internal route `/render/[versionId]/[slide]` in Chromium with a service token (`FORGECY_RENDER_TOKEN`) and screenshots the page. This makes the worker depend on the web app being up and reachable, and the route has to accept a second kind of authentication.

## Decision

`SlideRenderer` (`renderSlideHtml` in `packages/carousel`) is a pure function that returns a self-contained HTML document: inline CSS, fonts and images as `data:` URLs, a CSP that forbids any network request. Everyone uses it the same way:

- the worker calls it in process and passes the HTML to Chromium with `page.setContent`, with the network blocked;
- the web app serves it from the `/render/templates/...` routes (template catalog and editor) and `/render/slide` (editor preview), behind the user's session.

The same function and the same input bytes give the same slide in preview and in export. `FORGECY_RENDER_TOKEN` is no longer needed by the renderer.

## Consequences

Export works even with the web app down and opens no service port. The worker must read templates from the catalog in the database (ZIP packages in storage) and assets from storage, checking that every asset belongs to the export's client. The `worker` image starts from `mcr.microsoft.com/playwright` with the same version as `playwright-core`; a test verifies this.
