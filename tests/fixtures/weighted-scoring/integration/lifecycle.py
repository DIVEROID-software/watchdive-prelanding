"""One-person stage score, planned as a sum of upward deltas.

Internal truth is the highest stage from score.py. Meta has no per-person
maximum: it adds values, and a repeated event id does not replace the first
value. This module therefore:

- waits 48 hours from the signup anchor, or until a qualifying live USD 3
  payment, before the first emission
- sends that highest score once
- sends only the positive difference when the highest score later rises
- never sends a negative correction after a successful send

Elapsed time is not evidence that a payment is absent. A missing payment
stays unknown. A dry-run writes stage_simulation only. It does not write
the outbox, a receipt, or the sent watermark. Purchase stays 3.00 USD and
is not written into either table. Nothing here opens a socket.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

from score import score_snapshot

STAGE_EVENT = "WatchDiveStageScore"
STAGE_CONTENT = "watchdive_stage_score"
PURCHASE_VALUE = "3.00"
PURCHASE_CURRENCY = "USD"
ALLOWED_TARGETS = {1, 3, 5, 10, 30}
ALLOWED_DELTAS = {"1", "2", "3", "4", "5", "7", "9", "10", "20", "25", "27", "29", "30"}
NATIVE_CAMPAIGNS = frozenset(
    {
        "120251732832820215",
        "120251732986720215",
        "120251732986870215",
        "120251732987650215",
    }
)
NATIVE_LIMITATIONS = (
    "Meta sums WatchDiveStageScore values. It does not store a per-person maximum.",
    "Sending the same event_id again does not replace the value Meta kept.",
    "The first sent value is the highest stage at eligibility. A later rise uses a new event id whose value is only the difference, so the sent sum equals that newer highest stage.",
    "A sent sum cannot be reduced. Refunds, removed phones, and withdrawn measurement consent do not produce a negative event. The internal score can fall and the report keeps the overstatement.",
    "Each sent event can count as its own conversion. The value sum tracks the highest stage. The conversion count tracks upward sends.",
    "USD on WatchDiveStageScore is the currency code the API requires for the score scale. Purchase stays 3.00 USD and is not sent by this pipeline.",
    "A dry-run writes the simulation table only. It does not advance the sent watermark or consume a later send.",
    "Forty-eight hours without a payment observation is not an unpaid payment. Unknown stays unknown until an explicit complete snapshot or a complete CRM score says there was no payment.",
    "An ambiguous, claimed, or sending acknowledgement blocks a newer stage. It is not counted as sent.",
)


def _aware(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp needs a timezone")
    return parsed.astimezone(timezone.utc)


def _campaign_fold(seen: set[str], bad: bool) -> tuple[str | None, bool]:
    if bad or len(seen) > 1:
        return None, True
    if len(seen) == 1:
        return next(iter(seen)), False
    return None, False


def reduce_observations(rows: list[dict], now: datetime, maturity: timedelta) -> dict:
    """Fold redacted observations into one score_snapshot input."""
    rows = sorted(rows, key=lambda item: (item["observed_at"], item.get("seq", 0)))
    if not rows:
        raise ValueError("person has no observations")
    person_key = rows[0]["person_key"]
    email_state = None
    phone_state = None
    sms = "missing"
    sms_loaded = True
    measurement = "unknown"
    data_plane = None
    first_seen = None
    excluded = None
    saw_signup = False
    payments: dict[str, dict] = {}
    sources = []
    campaign_seen: set[str] = set()
    campaign_bad = False
    for row in rows:
        if row["person_key"] != person_key:
            raise ValueError("observation batch mixed people")
        kind = row["kind"]
        body = row["body"]
        sources.append(row.get("source"))
        if kind == "email_signup":
            saw_signup = True
            if first_seen is None:
                first_seen = row["observed_at"]
            if email_state != "verified":
                email_state = "signup"
            if body.get("phone_present") is True:
                phone_state = "saved"
            elif body.get("phone_present") is False and phone_state != "saved":
                phone_state = "absent"
            if body.get("sms_consent"):
                sms = body["sms_consent"]
            if body.get("suspect") is True:
                excluded = "suspect"
            elif body.get("suppressed") is True and excluded is None:
                excluded = "suppressed"
            if body.get("measurement"):
                measurement = body["measurement"]
            if data_plane is None and body.get("data_plane"):
                data_plane = body["data_plane"]
            if "campaign_id" in body:
                campaign_id = body.get("campaign_id")
                if campaign_id not in NATIVE_CAMPAIGNS:
                    campaign_bad = True
                else:
                    campaign_seen.add(campaign_id)
        elif kind == "email_verified":
            email_state = "verified"
        elif kind == "phone_saved":
            phone_state = "saved"
            sms = body.get("sms_consent") or "missing"
            sms_loaded = sms != "unknown"
        elif kind == "phone_data_withdrawn":
            phone_state = "absent"
            sms = "missing"
        elif kind == "measurement":
            measurement = body.get("measurement") or "unknown"
        elif kind == "payment":
            payment = dict(body["payment"])
            payments[str(payment["payment_id"])] = payment
        elif kind == "exclude":
            excluded = body.get("reason")
        else:
            raise ValueError("unknown observation kind")

    mature = False
    if first_seen is not None:
        mature = _aware(first_seen) + maturity <= now
    if email_state is None:
        email_state = "unknown"
    if phone_state is None:
        phone_state = "unknown"
    if payments:
        facts_payment: dict = {"payments": list(payments.values())}
    else:
        facts_payment = {"payment": {"loaded": False}}
    campaign_id, campaign_conflict = _campaign_fold(campaign_seen, campaign_bad)
    facts = {
        "person_key": person_key,
        "email_state": email_state,
        "email_loaded": email_state != "unknown",
        "phone_state": phone_state,
        "phone_loaded": phone_state != "unknown",
        "sms_consent": sms,
        "sms_consent_loaded": sms_loaded,
        "phone_only_lead_valid": False,
        "excluded": excluded,
        **facts_payment,
    }
    scored = score_snapshot(facts)
    qualified = scored["payment_contribution"] == "qualified"
    return {
        "person_key": person_key,
        "first_seen_at": first_seen,
        "saw_signup": saw_signup,
        "mature": mature,
        "measurement": measurement,
        "data_plane": data_plane or "unknown",
        "campaign_id": campaign_id,
        "campaign_conflict": campaign_conflict,
        "sources": sorted({item for item in sources if item}),
        "ranking_score": scored["ranking_score"],
        "completeness": scored["completeness"],
        "stage": scored["stage"],
        "internal_score": scored["score"],
        "payment_qualified": qualified,
        "sms_marketing_consent": scored.get("sms_marketing_consent"),
        "phone_contribution": scored["phone_contribution"],
    }


def _event_id(person_key: str, target: int) -> str:
    return f"wd-stage:{person_key}:up:{target}"


def _purchase_shape(qualified: bool) -> dict | None:
    if not qualified:
        return None
    shape = {
        "event_name": "Purchase",
        "send": False,
        "custom_data": {
            "value": PURCHASE_VALUE,
            "currency": PURCHASE_CURRENCY,
            "content_name": "watchdive_reservation_fee",
        },
        "reason": "A live reservation charge is 3.00 USD. The stage score is not this charge.",
    }
    if shape["custom_data"]["value"] != "3.00" or shape["send"] is not False:
        raise RuntimeError("purchase shape drifted")
    return shape


def decide_person(state: dict, emissions: list[dict], config: dict) -> dict:
    """Choose the unsent delta for one person. Does not write."""
    person = state["person_key"]
    sent_rows = [
        item
        for item in emissions
        if item.get("person_key") == person and item.get("status") == "sent"
    ]
    sent = sum(int(item["delta_value"]) for item in sent_rows)
    ranking = state["ranking_score"]
    reasons: list[str] = []
    eligible = True
    cohort_start = config.get("cohort_start")
    if not cohort_start:
        eligible = False
        reasons.append("cohort_start_unconfigured")
    elif not state["saw_signup"] or not state["first_seen_at"]:
        eligible = False
        reasons.append("baseline_missing")
    else:
        first_seen = _aware(state["first_seen_at"])
        if first_seen < _aware(cohort_start):
            eligible = False
            reasons.append("historical_cohort")
        elif state["data_plane"] != "live":
            eligible = False
            reasons.append("data_plane_not_live")
        elif state.get("campaign_conflict") or state.get("campaign_id") not in NATIVE_CAMPAIGNS:
            eligible = False
            reasons.append("campaign_attribution_missing")
        elif state["measurement"] != "granted":
            eligible = False
            reasons.append("measurement_consent_not_granted")
        elif state["completeness"] != "complete" or ranking is None:
            eligible = False
            reasons.append("partial_or_unknown")
        elif ranking not in ALLOWED_TARGETS:
            eligible = False
            reasons.append("ranking_outside_stage_scale")
        elif not (state["mature"] or (state["payment_qualified"] and ranking == 30)):
            eligible = False
            reasons.append("awaiting_maturity")
        elif state["payment_qualified"] and ranking == 30 and not state["mature"]:
            reasons.append("paid_finalizes_early")
    if config.get("export_mode") == "live":
        eligible = False
        reasons.append("sender_disabled")
    elif config.get("export_mode") != "dry-run":
        eligible = False
        reasons.append("export_mode_not_dry_run")
    unresolved = any(
        item.get("person_key") == person and item.get("status") in {"ambiguous", "claimed", "sending"}
        for item in emissions
    )
    if unresolved:
        eligible = False
        reasons.append("unresolved_acknowledgement")
    overstatement = 0
    desired = None
    if ranking is None:
        if sent:
            reasons.append("held_partial_after_send")
    elif sent > ranking:
        overstatement = sent - ranking
        reasons.append("sent_sum_above_internal_score")
        eligible = False
    elif eligible and ranking > sent:
        delta = ranking - sent
        if str(delta) not in ALLOWED_DELTAS or sent + delta != ranking or delta <= 0:
            raise RuntimeError("delta does not land on the highest stage")
        desired = {
            "event_id": _event_id(person, ranking),
            "person_key": person,
            "event_name": STAGE_EVENT,
            "target_score": ranking,
            "delta_value": str(delta),
            "currency": "USD",
            "content_name": STAGE_CONTENT,
            "value_kind": "stage_score_delta",
            "status": "simulated",
            "reason": "upward_to_highest_stage",
            "campaign_id": state.get("campaign_id"),
        }
        if any(item["event_id"] == desired["event_id"] for item in sent_rows):
            raise RuntimeError("sent event id collided with a new delta")
    elif eligible and ranking == sent:
        reasons.append("already_at_highest_stage")
    purchase = _purchase_shape(bool(state["payment_qualified"]))
    if purchase and purchase["custom_data"]["value"] in {30, "30", "30.00"}:
        raise RuntimeError("stage score leaked into purchase")
    return {
        "person_key": person,
        "internal_highest": ranking,
        "completeness": state["completeness"],
        "stage": state["stage"],
        "measurement": state["measurement"],
        "data_plane": state["data_plane"],
        "campaign_id": state.get("campaign_id"),
        "sources": state["sources"],
        "eligible": bool(desired),
        "reasons": reasons,
        "flushed_sum": sent,
        "sent_sum": sent,
        "armed_delta": int(desired["delta_value"]) if desired else 0,
        "armed_event_id": desired["event_id"] if desired else None,
        "overstatement": overstatement,
        "desired": desired,
        "purchase_shape": purchase,
        "sms_marketing_consent": state["sms_marketing_consent"],
        "phone_ownership_verified": False,
    }


def plan_observations(observations: list[dict], emissions: list[dict], config: dict) -> dict:
    maturity_hours = config.get("maturity_hours", 48)
    if not isinstance(maturity_hours, int) or isinstance(maturity_hours, bool) or maturity_hours <= 0:
        raise ValueError("maturity_hours must be a positive integer")
    now = _aware(config["now"])
    maturity = timedelta(hours=maturity_hours)
    grouped: dict[str, list[dict]] = {}
    for row in observations:
        grouped.setdefault(row["person_key"], []).append(row)
    people = []
    for person_key in sorted(grouped):
        state = reduce_observations(grouped[person_key], now, maturity)
        people.append(decide_person(state, emissions, config))
    sent_values = [int(item["delta_value"]) for item in emissions if item.get("status") == "sent"]
    return {
        "send": False,
        "network": False,
        "native_per_person_max": False,
        "native_limitations": list(NATIVE_LIMITATIONS),
        "maturity_hours": maturity_hours,
        "people": people,
        "flushed_value_sum": sum(sent_values),
        "sent_value_sum": sum(sent_values),
        "armed_value_sum": sum(person["armed_delta"] for person in people),
        "purchase_events": [],
    }


def _freeze_live(connection: sqlite3.Connection) -> tuple:
    emission = [
        tuple(row)
        for row in connection.execute(
            """
            SELECT event_id, status, delta_value, flushed_at
            FROM stage_emission
            ORDER BY event_id
            """
        )
    ]
    outbox = [
        tuple(row)
        for row in connection.execute(
            """
            SELECT event_id, status, delta_value, receipt_events_received, http_status
            FROM stage_outbox
            ORDER BY event_id
            """
        )
    ]
    marks = [
        tuple(row)
        for row in connection.execute(
            "SELECT person_key, sent_sum FROM stage_watermark ORDER BY person_key"
        )
    ]
    return (emission, outbox, marks)


def record_simulation(connection: sqlite3.Connection, planned: dict, simulated_at: str) -> dict:
    """Replace each planned person's simulation row. Does not touch live send state."""
    if planned.get("network") is not False or planned.get("send") is not False:
        raise RuntimeError("plan tried to send")
    if planned.get("purchase_events"):
        raise RuntimeError("plan tried to queue a purchase")
    if "@" in simulated_at or simulated_at.startswith("+"):
        raise RuntimeError("simulation clock was refused")
    before = _freeze_live(connection)
    written = 0
    for person in planned["people"]:
        desired = person.get("desired")
        if desired and (
            desired.get("event_name") != STAGE_EVENT or desired.get("content_name") != STAGE_CONTENT
        ):
            raise RuntimeError("stage emission lost its event name")
        if desired and desired.get("delta_value") in {"3.00", "30.00"}:
            raise RuntimeError("stage delta was formatted as money")
        connection.execute("DELETE FROM stage_simulation WHERE person_key = ?", (person["person_key"],))
        if not desired:
            continue
        connection.execute(
            """
            INSERT INTO stage_simulation (
              event_id, person_key, event_name, target_score, delta_value,
              currency, content_name, value_kind, simulated_at, reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                desired["event_id"],
                desired["person_key"],
                desired["event_name"],
                desired["target_score"],
                desired["delta_value"],
                desired["currency"],
                desired["content_name"],
                desired["value_kind"],
                simulated_at,
                desired["reason"],
            ),
        )
        written += 1
    connection.commit()
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    if _freeze_live(connection) != before:
        raise RuntimeError("simulation wrote a live receipt")
    totals = connection.execute(
        """
        SELECT COALESCE(SUM(CAST(delta_value AS INTEGER)), 0) AS total, COUNT(*) AS n
        FROM stage_simulation
        """
    ).fetchone()
    sent = connection.execute(
        """
        SELECT COALESCE(SUM(CAST(delta_value AS INTEGER)), 0) AS total, COUNT(*) AS n
        FROM stage_outbox
        WHERE status = 'sent'
        """
    ).fetchone()
    return {
        "flushed": 0,
        "flushed_sum": int(sent["total"]),
        "flushed_rows": int(sent["n"]),
        "simulated": written,
        "simulated_sum": int(totals["total"]),
        "simulated_rows": int(totals["n"]),
        "network": False,
    }


def apply_plan(connection: sqlite3.Connection, planned: dict, armed_at: str) -> dict:
    """Planning does not arm the live outbox. The disabled sender does that."""
    del connection, armed_at
    if planned.get("network") is not False or planned.get("send") is not False:
        raise RuntimeError("plan tried to send")
    if planned.get("purchase_events"):
        raise RuntimeError("plan tried to queue a purchase")
    return {"armed_writes": 0, "cancelled": 0, "network": False, "live_writes": 0}


def flush_armed(connection: sqlite3.Connection, planned: dict, flushed_at: str) -> dict:
    """Historical name. This records a simulation and does not mark a live send."""
    if any(person.get("purchase_shape") and person["purchase_shape"].get("send") for person in planned["people"]):
        raise RuntimeError("purchase send flag drifted")
    return record_simulation(connection, planned, flushed_at)


def assert_export_is_dry_run(blob: str) -> None:
    parsed = json.loads(blob)
    if "@" in blob:
        raise RuntimeError("export contains an address")
    for person in parsed.get("people", []):
        desired = person.get("desired")
        if desired:
            delta = str(desired.get("delta_value"))
            if "." in delta or delta in {"3.00", "30.00"}:
                raise RuntimeError("stage delta formatted as money")
        purchase = person.get("purchase_shape")
        if purchase:
            value = purchase["custom_data"]["value"]
            if value != PURCHASE_VALUE or purchase["send"] is not False:
                raise RuntimeError("purchase export drifted")
            if purchase["event_name"] != "Purchase":
                raise RuntimeError("purchase name drifted")
        for key in ("internal_highest", "armed_delta", "flushed_sum"):
            if person.get(key) in {None}:
                continue
    if parsed.get("purchase_events"):
        raise RuntimeError("purchase events were queued")
    if parsed.get("network") is not False or parsed.get("send") is not False:
        raise RuntimeError("plan claimed a send")
