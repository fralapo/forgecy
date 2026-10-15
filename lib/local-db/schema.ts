/** Initial local schema. JSON values are stored as JSON text and decoded by the adapter. */
export const LOCAL_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 industry TEXT NOT NULL DEFAULT '', website TEXT, profile TEXT NOT NULL DEFAULT '{}',
 knowledge_revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_owner_idx ON clients(owner_id);

CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('website','note','document','social')), title TEXT NOT NULL, url TEXT,
 body TEXT NOT NULL DEFAULT '', file_path TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','error')), error TEXT,
 captured_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 content_sha256 TEXT CHECK(content_sha256 IS NULL OR length(content_sha256)=64),
 source_metadata TEXT NOT NULL DEFAULT '{}', UNIQUE(id,client_id)
);
CREATE INDEX IF NOT EXISTS sources_client_idx ON sources(client_id);
CREATE INDEX IF NOT EXISTS sources_website_lookup_idx ON sources(client_id,kind,url) WHERE kind='website';

CREATE TABLE IF NOT EXISTS offers (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('product','service')), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 description TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', benefits TEXT NOT NULL DEFAULT '[]',
 price REAL, currency TEXT NOT NULL DEFAULT 'EUR', cta TEXT NOT NULL DEFAULT '', source_id TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','verified','archived')),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,client_id),
 FOREIGN KEY(source_id,client_id) REFERENCES sources(id,client_id)
);
CREATE INDEX IF NOT EXISTS offers_client_idx ON offers(client_id);

CREATE TABLE IF NOT EXISTS dossiers (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','stale')),
 findings TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '', approved_at TEXT,
 created_at TEXT NOT NULL, knowledge_revision INTEGER NOT NULL DEFAULT 0,
 evidence_report TEXT NOT NULL DEFAULT '{}', ai_job_id TEXT UNIQUE, UNIQUE(client_id,version)
);
CREATE INDEX IF NOT EXISTS dossiers_client_idx ON dossiers(client_id,version DESC);

CREATE TABLE IF NOT EXISTS campaigns (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 offer_id TEXT, title TEXT NOT NULL, objective TEXT NOT NULL, period TEXT NOT NULL,
 strategy TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','archived')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,client_id),
 FOREIGN KEY(offer_id,client_id) REFERENCES offers(id,client_id)
);
CREATE INDEX IF NOT EXISTS campaigns_client_idx ON campaigns(client_id);

CREATE TABLE IF NOT EXISTS contents (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL, offer_id TEXT, parent_id TEXT,
 channel TEXT NOT NULL CHECK(channel IN ('instagram','linkedin')),
 format TEXT NOT NULL CHECK(format IN ('post','carousel','document')),
 title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', slides TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','stale')),
 offer_version INTEGER, revision INTEGER NOT NULL DEFAULT 1, source_revision INTEGER,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, editorial_brief TEXT NOT NULL DEFAULT '{}',
 image_path TEXT, UNIQUE(id,client_id),
 FOREIGN KEY(campaign_id,client_id) REFERENCES campaigns(id,client_id),
 FOREIGN KEY(offer_id,client_id) REFERENCES offers(id,client_id),
 FOREIGN KEY(parent_id,client_id) REFERENCES contents(id,client_id)
);
CREATE INDEX IF NOT EXISTS contents_campaign_idx ON contents(campaign_id);
CREATE INDEX IF NOT EXISTS contents_client_idx ON contents(client_id);

CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','leader')), body TEXT NOT NULL,
 metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_client_idx ON messages(client_id,created_at);

CREATE TABLE IF NOT EXISTS ai_jobs (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('dossier','mission','strategy')),
 payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 result TEXT NOT NULL DEFAULT '{}', error TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 max_attempts INTEGER NOT NULL DEFAULT 2 CHECK(max_attempts BETWEEN 1 AND 3), run_after TEXT NOT NULL,
 locked_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT, lease_token TEXT
);
CREATE INDEX IF NOT EXISTS ai_jobs_claim_idx ON ai_jobs(status,run_after,created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS ai_jobs_client_idx ON ai_jobs(client_id,created_at DESC);

CREATE TABLE IF NOT EXISTS missions (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','proposed','approved','rejected','failed')),
 request TEXT NOT NULL, proposed_action TEXT, payload TEXT NOT NULL DEFAULT '{}', error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ai_job_id TEXT UNIQUE REFERENCES ai_jobs(id) ON DELETE SET NULL,
 UNIQUE(id,client_id)
);
CREATE INDEX IF NOT EXISTS missions_client_idx ON missions(client_id,created_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 mission_id TEXT NOT NULL, agent TEXT NOT NULL, recipient TEXT NOT NULL, summary TEXT NOT NULL,
 result TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
 FOREIGN KEY(mission_id,client_id) REFERENCES missions(id,client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_events_mission_idx ON agent_events(mission_id,created_at);

CREATE TABLE IF NOT EXISTS social_accounts (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform='instagram'), remote_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
 token_ciphertext TEXT NOT NULL, token_expires_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(client_id,platform,remote_id), UNIQUE(id,client_id)
);
CREATE TABLE IF NOT EXISTS social_snapshots (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, data TEXT NOT NULL, period TEXT NOT NULL, collected_at TEXT NOT NULL,
 FOREIGN KEY(account_id,client_id) REFERENCES social_accounts(id,client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS social_snapshots_client_idx ON social_snapshots(client_id,collected_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_signals (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN ('instagram','linkedin','website','review','support','other')),
 kind TEXT NOT NULL CHECK(kind IN ('comment','question','objection','review','faq','dm','other')),
 topic TEXT NOT NULL CHECK(length(trim(topic)) BETWEEN 2 AND 160),
 excerpt TEXT NOT NULL CHECK(length(trim(excerpt)) BETWEEN 5 AND 2500),
 audience_need TEXT NOT NULL DEFAULT '' CHECK(length(audience_need)<=1000),
 source_url TEXT CHECK(source_url IS NULL OR length(source_url)<=1500),
 context TEXT NOT NULL DEFAULT '' CHECK(length(context)<=1200), observed_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS community_signals_client_idx ON community_signals(client_id,created_at DESC);
CREATE INDEX IF NOT EXISTS community_signals_topic_idx ON community_signals(client_id,lower(trim(topic)));

CREATE TABLE IF NOT EXISTS strategies (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 dossier_id TEXT NOT NULL REFERENCES dossiers(id), ai_job_id TEXT UNIQUE REFERENCES ai_jobs(id) ON DELETE SET NULL,
 version INTEGER NOT NULL CHECK(version>0), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','stale')),
 knowledge_revision INTEGER NOT NULL, blueprint TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT,
 UNIQUE(client_id,version)
);
CREATE INDEX IF NOT EXISTS strategies_client_idx ON strategies(client_id,version DESC);

CREATE TABLE IF NOT EXISTS editorial_entries (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 content_id TEXT, channel TEXT NOT NULL CHECK(channel IN ('instagram','linkedin','facebook','website','email')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240), notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea','planned','ready','completed','cancelled')),
 planned_at TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Rome' CHECK(length(timezone) BETWEEN 3 AND 80),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,client_id), FOREIGN KEY(content_id,client_id) REFERENCES contents(id,client_id)
);
CREATE INDEX IF NOT EXISTS editorial_entries_client_time_idx ON editorial_entries(client_id,planned_at);

CREATE TABLE IF NOT EXISTS website_crawl_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL, hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 4 AND 253),
 page_budget INTEGER NOT NULL CHECK(page_budget BETWEEN 1 AND 6), requested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS website_crawl_client_window_idx ON website_crawl_requests(client_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS website_crawl_actor_window_idx ON website_crawl_requests(requested_by,requested_at DESC);

CREATE TABLE IF NOT EXISTS source_chunks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, source_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 79), body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1700),
 created_at TEXT NOT NULL, UNIQUE(source_id,ordinal),
 FOREIGN KEY(source_id,client_id) REFERENCES sources(id,client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS source_chunks_client_source_idx ON source_chunks(client_id,source_id);

CREATE TABLE IF NOT EXISTS ai_provider_usage (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL, job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL,
 provider TEXT NOT NULL CHECK(provider IN ('openrouter','openai')), provider_request_id TEXT CHECK(provider_request_id IS NULL OR length(provider_request_id)<=160),
 operation TEXT NOT NULL CHECK(operation IN ('chat','adapt','dossier','strategy','mission','image')),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 180), prompt_tokens INTEGER CHECK(prompt_tokens IS NULL OR prompt_tokens>=0),
 completion_tokens INTEGER CHECK(completion_tokens IS NULL OR completion_tokens>=0), total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens>=0),
 reported_cost_usd REAL CHECK(reported_cost_usd IS NULL OR reported_cost_usd>=0),
 usage_status TEXT NOT NULL CHECK(usage_status IN ('reported','unavailable')), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_provider_usage_client_recent_idx ON ai_provider_usage(client_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_provider_usage_owner_recent_idx ON ai_provider_usage(requested_by,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_usage_external_id_unique ON ai_provider_usage(provider,provider_request_id) WHERE provider_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_preferences (
 owner_id TEXT PRIMARY KEY, text_model TEXT CHECK(text_model IS NULL OR length(text_model) BETWEEN 1 AND 180),
 image_model TEXT CHECK(image_model IS NULL OR length(image_model) BETWEEN 1 AND 180), updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS sources_fts_insert AFTER INSERT ON sources WHEN new.status='ready'
 BEGIN INSERT INTO source_fts(id,title,body) VALUES(new.id,new.title,substr(new.body,1,20000)); END;
CREATE TRIGGER IF NOT EXISTS sources_fts_update AFTER UPDATE OF title,body,status ON sources
 BEGIN DELETE FROM source_fts WHERE id=old.id; INSERT INTO source_fts(id,title,body) SELECT new.id,new.title,substr(new.body,1,20000) WHERE new.status='ready'; END;
CREATE TRIGGER IF NOT EXISTS sources_fts_delete AFTER DELETE ON sources
 BEGIN DELETE FROM source_fts WHERE id=old.id; END;
`;

export const JSON_COLUMNS: Record<string, ReadonlySet<string>> = {
 clients: new Set(["profile"]), offers: new Set(["benefits"]), dossiers: new Set(["findings", "evidence_report"]),
 campaigns: new Set(["strategy"]), contents: new Set(["slides", "editorial_brief"]), messages: new Set(["metadata"]),
 missions: new Set(["payload"]), agent_events: new Set(["result"]), social_snapshots: new Set(["data"]),
 audit_events: new Set(["details"]), sources: new Set(["source_metadata"]), strategies: new Set(["blueprint"]),
 ai_jobs: new Set(["payload", "result"]),
};

export const TABLES = new Set([
 "clients", "sources", "offers", "dossiers", "campaigns", "contents", "messages", "ai_jobs", "missions",
 "agent_events", "social_accounts", "social_snapshots", "audit_events", "community_signals", "strategies",
 "editorial_entries", "website_crawl_requests", "source_chunks", "ai_provider_usage",
 "ai_preferences",
]);
