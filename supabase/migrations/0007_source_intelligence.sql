-- V14: durable provenance for imported website evidence and model validation audits.
-- Run after 0006_quality_gates.sql. All rows inherit existing client RLS policies.
alter table public.sources
  add column if not exists content_sha256 text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.sources
  add constraint forgecy_source_sha256_format
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$');

create index if not exists sources_website_lookup_idx
  on public.sources(client_id,kind,url) where kind='website';

alter table public.dossiers
  add column if not exists evidence_report jsonb not null default '{}'::jsonb;

comment on column public.sources.content_sha256 is
  'SHA-256 of normalized extracted website text, for no-op reimports and source tracking.';
comment on column public.sources.source_metadata is
  'Provenance: crawl root, fetched URL, import policy and extraction kind. Untrusted metadata.';
comment on column public.dossiers.evidence_report is
  'Deterministic validation outcome: verified, downgraded, invalid references and coverage.';
