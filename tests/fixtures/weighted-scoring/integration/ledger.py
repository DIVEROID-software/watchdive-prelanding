"""SQLite ledger for stage observations and dry-run emissions.

The file is created only at an explicit absolute path that is outside the
landing tree. This module does not open a socket.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SCHEMA_SQL = SCHEMA_PATH.read_text(encoding="utf-8")

KINDS = {
    "email_signup",
    "email_verified",
    "phone_saved",
    "phone_data_withdrawn",
    "measurement",
    "payment",
    "exclude",
}
SOURCES = {"email", "oauth", "phone", "stripe", "consent", "crm"}
MEASUREMENTS = {"granted", "withdrawn", "withheld", "pending", "unknown", "unrecognized"}
SMS = {"granted", "withdrawn", "missing", "unknown"}
PLANES = {"live", "test", "preview", "development", "staging", "unknown"}
BODY_KEYS = {
    "measurement",
    "phone_present",
    "sms_consent",
    "suspect",
    "suppressed",
    "data_plane",
    "payment",
    "reason",
    "campaign_id",
}
PAYMENT_KEYS = {
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
}


class LedgerError(ValueError):
    """The ledger refused the write. Nothing was stored."""


def assert_ledger_path(file: str) -> Path:
    path = Path(file)
    if not path.is_absolute():
        raise LedgerError("ledger path must be absolute")
    if path.suffix != ".sqlite":
        raise LedgerError("ledger file must end in .sqlite")
    resolved = path.resolve()
    parts = resolved.parts
    if "landing" in parts or "src" in parts:
        raise LedgerError("ledger path must stay outside the landing tree")
    if not resolved.parent.is_dir():
        raise LedgerError("ledger directory does not exist")
    return resolved


def connect(file: str) -> sqlite3.Connection:
    path = assert_ledger_path(file)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = FULL")
    connection.executescript(SCHEMA_SQL)
    return connection


def _reject_contact(text: str) -> None:
    if "@" in text or "+1" in text or text.startswith("+"):
        raise LedgerError("contact-shaped text refused")


def _check_body(body: dict) -> dict:
    if not isinstance(body, dict):
        raise LedgerError("observation body must be an object")
    extra = set(body) - BODY_KEYS
    if extra:
        raise LedgerError("observation body has an unknown field")
    clean: dict = {}
    if "measurement" in body:
        if body["measurement"] not in MEASUREMENTS:
            raise LedgerError("measurement value is not an enum")
        clean["measurement"] = body["measurement"]
    if "phone_present" in body:
        if not isinstance(body["phone_present"], bool):
            raise LedgerError("phone_present must be boolean")
        clean["phone_present"] = body["phone_present"]
    if "sms_consent" in body:
        if body["sms_consent"] not in SMS:
            raise LedgerError("sms consent is not an enum")
        clean["sms_consent"] = body["sms_consent"]
    if "suspect" in body:
        if not isinstance(body["suspect"], bool):
            raise LedgerError("suspect must be boolean")
        clean["suspect"] = body["suspect"]
    if "suppressed" in body:
        if not isinstance(body["suppressed"], bool):
            raise LedgerError("suppressed must be boolean")
        clean["suppressed"] = body["suppressed"]
    if "data_plane" in body:
        if body["data_plane"] not in PLANES:
            raise LedgerError("data plane is not an enum")
        clean["data_plane"] = body["data_plane"]
    if "reason" in body:
        if body["reason"] not in {"suspect", "suppressed"}:
            raise LedgerError("exclude reason is not allowed")
        clean["reason"] = body["reason"]
    if "campaign_id" in body:
        campaign_id = body["campaign_id"]
        if not isinstance(campaign_id, str) or not campaign_id.isdigit() or not 15 <= len(campaign_id) <= 20:
            raise LedgerError("campaign id is not an opaque digit id")
        clean["campaign_id"] = campaign_id
    if "payment" in body:
        payment = body["payment"]
        if not isinstance(payment, dict) or set(payment) - PAYMENT_KEYS:
            raise LedgerError("payment object is not the redacted contract")
        payment_id = payment.get("payment_id")
        if not isinstance(payment_id, str) or len(payment_id) != 68 or not payment_id.startswith("pay:"):
            raise LedgerError("payment id is not an opaque hash")
        _reject_contact(payment_id)
        clean["payment"] = payment
    encoded = json.dumps(clean, sort_keys=True, separators=(",", ":"))
    _reject_contact(encoded)
    return clean


def append_observation(
    connection: sqlite3.Connection,
    *,
    dedupe_key: str,
    person_key: str,
    observed_at: str,
    kind: str,
    source: str,
    body: dict,
) -> bool:
    """Insert one observation. False means the dedupe key was already stored."""
    if kind not in KINDS or source not in SOURCES:
        raise LedgerError("observation kind or source is not allowed")
    if not isinstance(person_key, str) or len(person_key) != 68 or not person_key.startswith("crm:"):
        raise LedgerError("person key is not opaque")
    _reject_contact(person_key)
    _reject_contact(dedupe_key)
    _reject_contact(observed_at)
    clean = _check_body(body)
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO stage_observation
          (dedupe_key, person_key, observed_at, kind, source, body_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (dedupe_key, person_key, observed_at, kind, source, json.dumps(clean, sort_keys=True)),
    )
    connection.commit()
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return cursor.rowcount == 1


def load_observations(connection: sqlite3.Connection) -> list[dict]:
    rows = []
    for row in connection.execute(
        """
        SELECT rowid AS seq, person_key, observed_at, kind, source, body_json
        FROM stage_observation
        ORDER BY observed_at, rowid
        """
    ):
        body = json.loads(row["body_json"])
        _reject_contact(json.dumps(body))
        rows.append(
            {
                "seq": row["seq"],
                "person_key": row["person_key"],
                "observed_at": row["observed_at"],
                "kind": row["kind"],
                "source": row["source"],
                "body": body,
            }
        )
    return rows


def load_emissions(connection: sqlite3.Connection) -> list[dict]:
    rows = []
    for row in connection.execute(
        """
        SELECT event_id, person_key, event_name, target_score, delta_value,
               currency, content_name, value_kind, status, armed_at, flushed_at, reason
        FROM stage_emission
        ORDER BY armed_at, event_id
        """
    ):
        item = {key: row[key] for key in row.keys()}
        if item["event_name"] != "WatchDiveStageScore":
            raise LedgerError("emission table holds a non-stage event")
        if item["delta_value"] in {"3.00", "30.00"}:
            raise LedgerError("money-shaped value stored as a stage delta")
        rows.append(item)
    return rows


def load_sent_receipts(connection: sqlite3.Connection) -> list[dict]:
    """Sent outbox rows only. A dry-run simulation is not a receipt.

    The watermark must match the sent sum for every person. A disagreement
    fails closed and returns nothing the planner could send against.
    """
    rows = []
    for row in connection.execute(
        """
        SELECT event_id, person_key, event_name, target_score, delta_value,
               currency, content_name, value_kind, status, event_time, reason
        FROM stage_outbox
        WHERE status = 'sent'
        ORDER BY event_time, event_id
        """
    ):
        item = {key: row[key] for key in row.keys()}
        if item["event_name"] != "WatchDiveStageScore":
            raise LedgerError("outbox holds a non-stage event")
        if item["delta_value"] in {"3.00", "30.00"}:
            raise LedgerError("money-shaped value stored as a stage delta")
        rows.append(item)
    totals: dict[str, int] = {}
    for item in rows:
        totals[item["person_key"]] = totals.get(item["person_key"], 0) + int(item["delta_value"])
    marks = {
        row["person_key"]: row["sent_sum"]
        for row in connection.execute("SELECT person_key, sent_sum FROM stage_watermark")
    }
    if set(marks) != set(totals) or any(marks[key] != totals[key] for key in totals):
        raise LedgerError("watermark disagrees with sent receipts")
    return rows


def load_plan_emissions(connection: sqlite3.Connection) -> list[dict]:
    """Sent receipts plus unresolved rows that must block a newer stage.

    The sent sum still comes only from sent rows and must match the watermark.
    Ambiguous, claimed, and sending rows are returned with their own status.
    """
    sent = load_sent_receipts(connection)
    unresolved = []
    for row in connection.execute(
        """
        SELECT event_id, person_key, event_name, target_score, delta_value,
               currency, content_name, value_kind, status, event_time, reason
        FROM stage_outbox
        WHERE status IN ('ambiguous', 'claimed', 'sending')
        ORDER BY event_time, event_id
        """
    ):
        item = {key: row[key] for key in row.keys()}
        if item["event_name"] != "WatchDiveStageScore":
            raise LedgerError("outbox holds a non-stage event")
        if item["delta_value"] in {"3.00", "30.00"}:
            raise LedgerError("money-shaped value stored as a stage delta")
        unresolved.append(item)
    return sent + unresolved
