-- Redacted stage-score ledger. No email, phone, name, or raw payment id.
-- person_key is "crm:" plus 64 hex characters (sha256 of the CRM canonical address).

CREATE TABLE IF NOT EXISTS stage_observation (
  dedupe_key TEXT PRIMARY KEY,
  person_key TEXT NOT NULL CHECK (length(person_key) = 68 AND person_key GLOB 'crm:[0-9a-f]*'),
  observed_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  body_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stage_observation_person
  ON stage_observation (person_key, observed_at);

CREATE TABLE IF NOT EXISTS stage_emission (
  event_id TEXT PRIMARY KEY,
  person_key TEXT NOT NULL CHECK (length(person_key) = 68 AND person_key GLOB 'crm:[0-9a-f]*'),
  event_name TEXT NOT NULL CHECK (event_name = 'WatchDiveStageScore'),
  target_score INTEGER NOT NULL CHECK (target_score IN (1, 3, 5, 10, 30)),
  delta_value TEXT NOT NULL CHECK (
    delta_value IN ('1', '2', '3', '4', '5', '7', '9', '10', '20', '25', '27', '29', '30')
  ),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  content_name TEXT NOT NULL CHECK (content_name = 'watchdive_stage_score'),
  value_kind TEXT NOT NULL CHECK (value_kind = 'stage_score_delta'),
  status TEXT NOT NULL CHECK (status IN ('armed', 'flushed', 'cancelled')),
  armed_at TEXT NOT NULL,
  flushed_at TEXT,
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stage_emission_person
  ON stage_emission (person_key, status);

-- Dry-run only. The sender and the sent watermark never read this table.
CREATE TABLE IF NOT EXISTS stage_simulation (
  event_id TEXT PRIMARY KEY,
  person_key TEXT NOT NULL CHECK (length(person_key) = 68 AND person_key GLOB 'crm:[0-9a-f]*'),
  event_name TEXT NOT NULL CHECK (event_name = 'WatchDiveStageScore'),
  target_score INTEGER NOT NULL CHECK (target_score IN (1, 3, 5, 10, 30)),
  delta_value TEXT NOT NULL CHECK (
    delta_value IN ('1', '2', '3', '4', '5', '7', '9', '10', '20', '25', '27', '29', '30')
  ),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  content_name TEXT NOT NULL CHECK (content_name = 'watchdive_stage_score'),
  value_kind TEXT NOT NULL CHECK (value_kind = 'stage_score_delta'),
  simulated_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stage_simulation_person
  ON stage_simulation (person_key);

-- Live outbox. A row becomes sent only after events_received matches the batch.
CREATE TABLE IF NOT EXISTS stage_outbox (
  event_id TEXT PRIMARY KEY,
  person_key TEXT NOT NULL CHECK (length(person_key) = 68 AND person_key GLOB 'crm:[0-9a-f]*'),
  event_name TEXT NOT NULL CHECK (event_name = 'WatchDiveStageScore'),
  event_time TEXT NOT NULL CHECK (event_time GLOB '[0-9]*' AND length(event_time) BETWEEN 10 AND 12),
  target_score INTEGER NOT NULL CHECK (target_score IN (1, 3, 5, 10, 30)),
  delta_value TEXT NOT NULL CHECK (
    delta_value IN ('1', '2', '3', '4', '5', '7', '9', '10', '20', '25', '27', '29', '30')
  ),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  content_name TEXT NOT NULL CHECK (content_name = 'watchdive_stage_score'),
  value_kind TEXT NOT NULL CHECK (value_kind = 'stage_score_delta'),
  status TEXT NOT NULL CHECK (
    status IN ('ready', 'claimed', 'sending', 'sent', 'ambiguous', 'quarantined', 'cancelled')
  ),
  claim_token TEXT CHECK (
    claim_token IS NULL OR (length(claim_token) = 32 AND claim_token GLOB '[0-9a-f]*')
  ),
  campaign_id TEXT CHECK (
    campaign_id IS NULL OR (length(campaign_id) BETWEEN 15 AND 20 AND campaign_id GLOB '[0-9]*')
  ),
  em_hash TEXT CHECK (em_hash IS NULL OR instr(em_hash, '@') = 0),
  external_id_hash TEXT CHECK (
    external_id_hash IS NULL OR (length(external_id_hash) = 64 AND external_id_hash GLOB '[0-9a-f]*')
  ),
  reason TEXT NOT NULL,
  receipt_events_received INTEGER,
  http_status INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stage_outbox_status
  ON stage_outbox (status, event_time, event_id);

CREATE TABLE IF NOT EXISTS stage_sender_lock (
  lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1),
  owner TEXT NOT NULL CHECK (length(owner) > 0 AND instr(owner, '@') = 0),
  acquired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_watermark (
  person_key TEXT PRIMARY KEY CHECK (length(person_key) = 68 AND person_key GLOB 'crm:[0-9a-f]*'),
  sent_sum INTEGER NOT NULL CHECK (sent_sum >= 0 AND sent_sum <= 30),
  updated_at TEXT NOT NULL
);
