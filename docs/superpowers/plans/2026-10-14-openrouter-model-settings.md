# OpenRouter model settings — completed

The owner can select current OpenRouter text and image models in **Impostazioni**. The server fetches each catalog live, validates selections, and saves model IDs in the local workspace. Text and image choices are separate. The selected image model uses the same local `OPENROUTER_API_KEY` as text generation.

The feature is described in the [design note](../specs/2026-10-14-openrouter-model-settings-design.md). It was implemented and tested as part of the local-first architecture; choices move between computers with a workspace archive or Drive snapshot, while provider credentials stay local to each computer.
