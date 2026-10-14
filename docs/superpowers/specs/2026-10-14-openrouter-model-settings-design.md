# OpenRouter model settings

## Goal

Let the owner choose current OpenRouter text and image-generation models in Forgecy settings, without maintaining hard-coded provider catalogs.

## Design

The settings view requests the live text catalog (`GET /api/v1/models?output_modalities=text`) and image catalog (`GET /api/v1/images/models`) through the local server. Text and image selectors are separate. The server validates each chosen ID against its catalog and stores only the IDs in the local SQLite workspace. A missing catalog entry remains visible as unavailable until the owner selects another model.

The API key stays in each computer's server-only `.env.local`. The catalogs are fetched on settings entry and can be refreshed explicitly. Text generation reads the saved local choice then falls back to `OPENROUTER_MODEL`; image generation uses the saved image model and the same OpenRouter key. No provider key or model preference is shared through a hosted account.

## Delivery record

Implemented with live uncached catalog calls, validation, local `ai_preferences`, settings UI, selected image model generation, provider usage tracking and tests for normalization, fallback, image media type and size. Preferences transfer to another computer only as part of an explicit workspace export or Drive snapshot; API keys must be configured independently on each device.
