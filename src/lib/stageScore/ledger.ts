// Office SQLite ledger. Loaded only after the stage-score flag is on.
// The default website path never imports this module. It does not open a socket.
// SCHEMA_SQL is the same text as schema.sql and the Python integration schema.

export const SCHEMA_SQL = `-- Redacted stage-score ledger. No email, phone, name, or raw payment id.
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
`;

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

type Statement = {
  run: (...args: unknown[]) => { changes: number | bigint };
  all: () => Array<Record<string, unknown>>;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  close: () => void;
};

const BODY_KEYS = new Set([
  "measurement",
  "phone_present",
  "sms_consent",
  "suspect",
  "suppressed",
  "data_plane",
  "payment",
  "reason",
  "campaign_id",
]);

const PAYMENT_KEYS = new Set([
  "loaded",
  "status",
  "livemode",
  "mode",
  "webhook_verified",
  "amount_cents",
  "currency",
  "product_code",
  "refund_state",
  "dispute",
  "payment_id",
]);

export function assertLedgerPath(file: string): string {
  if (!file || !file.startsWith("/")) throw new LedgerError("ledger path must be absolute");
  if (!file.endsWith(".sqlite")) throw new LedgerError("ledger file must end in .sqlite");
  const parts = file.split("/").filter(Boolean);
  if (parts.includes("landing") || parts.includes("src")) {
    throw new LedgerError("ledger path must stay outside the landing tree");
  }
  return file;
}

function rejectContact(text: string): void {
  if (text.includes("@") || text.includes("+1") || text.startsWith("+")) {
    throw new LedgerError("contact-shaped text refused");
  }
}

function cleanBody(body: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw new LedgerError("observation body has an unknown field");
  }
  const encoded = JSON.stringify(body);
  rejectContact(encoded);
  const payment = body.payment;
  if (payment !== undefined) {
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
      throw new LedgerError("payment object is not the redacted contract");
    }
    for (const key of Object.keys(payment)) {
      if (!PAYMENT_KEYS.has(key)) throw new LedgerError("payment object is not the redacted contract");
    }
    const paymentId = (payment as { payment_id?: unknown }).payment_id;
    if (typeof paymentId !== "string" || !/^pay:[0-9a-f]{64}$/.test(paymentId)) {
      throw new LedgerError("payment id is not an opaque hash");
    }
  }
  if (body.campaign_id !== undefined) {
    if (typeof body.campaign_id !== "string" || !/^[0-9]{15,20}$/.test(body.campaign_id)) {
      throw new LedgerError("campaign id is not an opaque digit id");
    }
  }
  return body;
}

async function openDatabase(file: string): Promise<SqliteDatabase> {
  const specifier = ["node", "sqlite"].join(":");
  const mod = (await import(specifier)) as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new mod.DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec(SCHEMA_SQL);
  return db;
}

export async function appendObservation(input: {
  file: string;
  dedupeKey: string;
  personKey: string;
  observedAt: string;
  kind: string;
  source: string;
  body: Record<string, unknown>;
}): Promise<"inserted" | "duplicate"> {
  assertLedgerPath(input.file);
  if (!/^crm:[0-9a-f]{64}$/.test(input.personKey)) throw new LedgerError("person key is not opaque");
  rejectContact(input.dedupeKey);
  rejectContact(input.observedAt);
  rejectContact(input.personKey);
  const body = cleanBody(input.body);
  const db = await openDatabase(input.file);
  try {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO stage_observation
          (dedupe_key, person_key, observed_at, kind, source, body_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.dedupeKey,
        input.personKey,
        input.observedAt,
        input.kind,
        input.source,
        JSON.stringify(body),
      );
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(result.changes) === 1 ? "inserted" : "duplicate";
  } finally {
    db.close();
  }
}

export async function readLedger(file: string): Promise<{
  observations: number;
  emissions: number;
  blob: string;
}> {
  assertLedgerPath(file);
  const db = await openDatabase(file);
  try {
    const observations = db.prepare("SELECT body_json, dedupe_key, person_key, kind FROM stage_observation").all();
    const emissions = db.prepare("SELECT event_name, delta_value, content_name FROM stage_emission").all();
    const blob = JSON.stringify({ observations, emissions });
    rejectContact(blob);
    return { observations: observations.length, emissions: emissions.length, blob };
  } finally {
    db.close();
  }
}
