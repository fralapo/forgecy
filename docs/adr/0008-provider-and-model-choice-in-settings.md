# 0008 · Choice of AI service and model in Settings

- Status: accepted
- Date: 2026-10-06

## Context

The agency must be free to choose which service and which API each kind of work uses (for example DeepSeek through OpenRouter for text, Weave for images). Until now the choice was `.env` only (`AI_DEFAULT_PROVIDER`, `IMAGE_PROVIDERS`) with fixed default models, and changing it meant restarting the containers.

## Decision

- Settings > AI providers has a "Services and models" form (Admin only, `ai.providers.manage`): the text service and model, an optional fallback service and model, and the image services in order of use with a model each ("Off" excludes a service). Stored in `app_settings` under `ai.routing`, recorded in the activity log.
- Keys stay in `.env` and MCP logins stay in `mcp_connections`: the form chooses among them and never holds secrets. A chosen service without a key (or MCP connection) is skipped and the `.env` default is used, so a half-configured choice never stops work.
- The gateway accepts `routing` as a function; the worker resolves it from the settings, cached 15 seconds, so changes apply to new jobs without a restart. With nothing saved, routing is exactly the one from `.env` (ADR 0006).
- The model field is free text: any model id the service accepts (OpenRouter ids such as `deepseek/deepseek-chat` included). Empty means the service's default.

## Consequences

The AI policy still applies on top (`local_only` uses only the local model, `external_restricted` only approved services). Per-task routing (one model for slides, another for audits) is possible in the gateway but not exposed in the form yet.
