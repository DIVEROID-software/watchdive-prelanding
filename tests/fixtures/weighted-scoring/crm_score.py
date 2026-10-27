"""Map a Notion waitlist page onto the highest-stage score.

Column names match the live fetch schema used by
ads/autopilot/kr-report-20261019/collect_kr.py and
landing/watchdive-segments-20261025/src/lib/verification/contracts.ts.
The returned score and the aggregate contain no email, phone, Stripe id,
or page body. This module does not call Notion or Meta.
"""

from __future__ import annotations

import hashlib
import json

from score import PRODUCT_CODE, ScoreError, facts_from_redacted_view, merge_snapshots, score_snapshot

CONSENT_VERSION = "WD-SMS-CONSENT-V2"
MEASUREMENT_GRANTED = "WD-AD-MEASUREMENT-CONSENT-V1:granted"
MEASUREMENT_WITHDRAWN = "WD-AD-MEASUREMENT-CONSENT-V1:withdrawn"
MEASUREMENT_WITHHELD = "WD-AD-MEASUREMENT-CONSENT-V1:withheld"
MEASUREMENT_PENDING = "WD-AD-MEASUREMENT-CONSENT-V1:granted-lead-pending"
LIVE_STATUSES = {
    "paid",
    "refunded",
    "partially_refunded",
    "refund_pending",
    "disputed",
    "invalid",
    "open",
}
RESERVATION_COLUMNS = (
    "Reservation paid",
    "Reservation status",
    "Reservation amount cents",
    "Reservation currency",
    "Reservation mode",
    "Reservation paid at",
    "Reservation dispute",
    "Reservation refunded cents",
    "Reservation refund pending cents",
    "Reservation duplicate paid",
    "Reservation Stripe session",
    "Test reservation paid",
    "Test reservation status",
    "Test reservation mode",
)


def _text(prop) -> str:
    if not isinstance(prop, dict):
        return ""
    status = prop.get("status")
    if isinstance(status, dict):
        return str(status.get("name") or "").strip()
    for key in ("title", "rich_text"):
        items = prop.get(key)
        if isinstance(items, list):
            parts = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                if isinstance(item.get("plain_text"), str):
                    parts.append(item["plain_text"])
                else:
                    text = item.get("text")
                    if isinstance(text, dict) and isinstance(text.get("content"), str):
                        parts.append(text["content"])
            return "".join(parts).strip()
    selected = prop.get("select")
    if isinstance(selected, dict):
        return str(selected.get("name") or "").strip()
    return ""


def _check(prop):
    if not isinstance(prop, dict) or not isinstance(prop.get("checkbox"), bool):
        return None
    return prop["checkbox"]


def _number(prop):
    if not isinstance(prop, dict):
        return None
    value = prop.get("number")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _date_set(prop) -> bool:
    value = prop.get("date") if isinstance(prop, dict) else None
    return isinstance(value, dict) and bool(value.get("start"))


def _canonical_email(value: str) -> str:
    """Same folding as ads/autopilot/leads.py. The address is not returned."""
    value = value.strip().lower()
    if value.count("@") != 1 or any(char.isspace() for char in value):
        return ""
    local, domain = value.rsplit("@", 1)
    if not local or "." not in domain:
        return ""
    local = local.split("+", 1)[0]
    domain = "gmail.com" if domain == "googlemail.com" else domain
    if domain == "gmail.com":
        local = local.replace(".", "")
    return f"{local}@{domain}" if local else ""


def _opaque_key(page: dict) -> str:
    props = page.get("properties") if isinstance(page.get("properties"), dict) else {}
    canonical = _canonical_email(_text(props.get("Canonical email")) or _text(props.get("Email")))
    if canonical:
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return "crm:" + digest
    page_id = page.get("id")
    if isinstance(page_id, str) and page_id and "@" not in page_id and not page_id.startswith("+"):
        return "page:" + page_id
    raise ScoreError("page has no opaque identity")


def _consent_marker(prop) -> tuple[str, bool]:
    """Return a marker and whether the column was present. The cell text is dropped."""
    if prop is None:
        return "unknown", False
    text = _text(prop)
    lowered = text.lower()
    if "withdrawn" in lowered:
        return "withdrawn", True
    if CONSENT_VERSION in text:
        return CONSENT_VERSION, True
    if text:
        return "stored-without-version", True
    return "", True


def _measurement(prop) -> str:
    if prop is None:
        return "unknown"
    text = _text(prop)
    if text == MEASUREMENT_GRANTED:
        return "granted"
    if text == MEASUREMENT_WITHDRAWN:
        return "withdrawn"
    if text == MEASUREMENT_WITHHELD:
        return "withheld"
    if text == MEASUREMENT_PENDING:
        return "pending"
    if text == "":
        return "unknown"
    return "unrecognized"


def _schema_ok(props: dict, override) -> bool:
    if override is not None:
        return bool(override)
    return all(name in props for name in RESERVATION_COLUMNS)


def _unpaid() -> dict:
    return {"loaded": True, "status": "none", "livemode": True, "webhook_verified": True}


def _payment(props: dict, schema_ok: bool) -> tuple[dict, list[str]]:
    notes = []
    if not schema_ok:
        notes.append("reservation_schema_not_confirmed")
        return {"loaded": False}, notes
    live_paid = _check(props.get("Reservation paid"))
    test_paid = _check(props.get("Test reservation paid"))
    status = _text(props.get("Reservation status")).lower()
    test_status = _text(props.get("Test reservation status")).lower()
    mode = _text(props.get("Reservation mode")).lower()
    test_mode = _text(props.get("Test reservation mode")).lower()
    amount = _number(props.get("Reservation amount cents"))
    currency = _text(props.get("Reservation currency")).lower()
    dispute = _text(props.get("Reservation dispute")).lower() or "none"
    refunded = _number(props.get("Reservation refunded cents"))
    pending = _number(props.get("Reservation refund pending cents"))
    paid_at = _date_set(props.get("Reservation paid at"))
    session_present = bool(_text(props.get("Reservation Stripe session")))
    test_signal = test_paid is True or test_mode == "test" or test_status in {"paid", "open"}
    live_signal = live_paid is True or status in LIVE_STATUSES
    if not live_signal and not test_signal:
        return _unpaid(), notes
    if test_signal and (live_paid is True or status == "paid"):
        notes.append("live_and_test_conflict")
        return {"loaded": False}, notes
    if not session_present or not paid_at or amount is None or refunded is None or pending is None:
        if test_signal or mode == "test":
            notes.append("test_payment_identity_incomplete")
        else:
            notes.append("payment_identity_incomplete")
        return {"loaded": False}, notes
    if dispute == "won":
        notes.append("won_dispute_counts_in_scorer_and_not_in_collect_kr_paid_class")
    refunded_cents = int(refunded)
    pending_cents = int(pending)
    if pending_cents > 0:
        refund_state = "pending"
    elif refunded_cents >= 300:
        refund_state = "full"
    elif refunded_cents > 0:
        refund_state = "partial"
    else:
        refund_state = "none"
    test_mode_payment = test_signal or mode == "test"
    paid_status = (test_paid is True or test_status == "paid") if test_mode_payment else live_paid is True and status == "paid"
    if not test_mode_payment and (mode != "live" or not paid_status):
        paid_status = False
    payment = {
        "loaded": True,
        "status": "paid" if paid_status else "none",
        "livemode": not test_mode_payment and mode == "live",
        "mode": "test" if test_mode_payment else (mode or "test"),
        "webhook_verified": session_present and paid_at,
        "amount_cents": int(amount) if float(amount).is_integer() else amount,
        "currency": currency,
        "product_code": PRODUCT_CODE,
        "refund_state": refund_state,
        "dispute": dispute,
        "payment_id": "crm-live" if not test_mode_payment and paid_status else "crm-unqualified",
    }
    if paid_status and not test_mode_payment:
        notes.append("product_code_inferred_from_reservation_contract")
    return payment, notes


def redact_notion_page(page: dict, *, schema_ok=None) -> dict:
    """Build the scorer view. Contact strings are reduced to flags before return."""
    if not isinstance(page, dict) or not isinstance(page.get("properties"), dict):
        raise ScoreError("notion page properties are missing")
    props = page["properties"]
    person_key = _opaque_key(page)
    email_prop = props.get("Email")
    if "Email" not in props and "Canonical email" not in props:
        email_loaded = False
        email_present = False
    else:
        email_loaded = True
        email_present = bool(_canonical_email(_text(props.get("Canonical email")) or _text(email_prop)))
    verified = (
        _check(props.get("Email verified")) is True
        or _text(props.get("Verification status")).lower() == "verified"
        or _date_set(props.get("Verified at"))
    )
    phone_prop_present = "Phone" in props
    phone_present = phone_prop_present and bool(_text(props.get("Phone")))
    consent_marker, consent_loaded = _consent_marker(props.get("SMS consent") if "SMS consent" in props else None)
    excluded = None
    if _check(props.get("Suspect")) is True:
        excluded = "suspect"
    elif _text(props.get("Verification status")).lower() == "suppressed":
        excluded = "suppressed"
    payment, notes = _payment(props, _schema_ok(props, schema_ok))
    view = {
        "person_key": person_key,
        "email_loaded": email_loaded,
        "email_present": email_present,
        "email_verified": verified,
        "status": _text(props.get("Verification status")).lower(),
        "verified_at_set": _date_set(props.get("Verified at")),
        "phone_loaded": phone_prop_present,
        "phone_present": phone_present,
        "sms_consent_loaded": consent_loaded,
        "sms_consent_record": consent_marker,
        "phone_only_lead_valid": False,
        "suspect": _check(props.get("Suspect")) is True,
        "payment_loaded": payment.get("loaded") is True,
        "reservation_paid": payment.get("status") == "paid",
        "reservation_mode": payment.get("mode"),
        "webhook_verified": payment.get("webhook_verified"),
        "amount_cents": payment.get("amount_cents"),
        "currency": payment.get("currency"),
        "product_code": payment.get("product_code"),
        "refunded_cents": 300 if payment.get("refund_state") == "full" else (1 if payment.get("refund_state") == "partial" else 0),
        "refund_pending_cents": 1 if payment.get("refund_state") == "pending" else 0,
        "dispute": payment.get("dispute") or "none",
        "payment_id": payment.get("payment_id"),
        "measurement_consent": _measurement(props.get("Measurement consent") if "Measurement consent" in props else None),
        "notes": notes,
        "excluded_reason": excluded,
    }
    if payment.get("loaded") is False:
        view["payment_loaded"] = False
    serialized = json.dumps({key: value for key, value in view.items() if key != "person_key"}, default=str)
    if "@" in serialized or "+1" in serialized:
        raise ScoreError("redacted view still holds a contact string")
    return view


def score_notion_page(page: dict, *, schema_ok=None) -> dict:
    """Score one page. The opaque key is kept for merging and omitted from reports."""
    if _text((page.get("properties") or {}).get("Source")).lower() == "privacy_withdrawal":
        return {"skipped": "privacy_withdrawal", "score": None, "completeness": "excluded"}
    view = redact_notion_page(page, schema_ok=schema_ok)
    facts = facts_from_redacted_view(view)
    if view["excluded_reason"]:
        facts["excluded"] = view["excluded_reason"]
    scored = score_snapshot(facts)
    return {
        "person_key": scored["person_key"],
        "score": scored["score"],
        "lower_bound": scored["lower_bound"],
        "completeness": scored["completeness"],
        "stage": scored["stage"],
        "ranking_score": scored["ranking_score"],
        "phone_contribution": scored["phone_contribution"],
        "sms_marketing_consent": scored["sms_marketing_consent"],
        "phone_ownership_verified": False,
        "payment_contribution": scored["payment_contribution"],
        "measurement_consent": view["measurement_consent"],
        "notes": view["notes"],
    }


def aggregate_notion_pages(pages, *, schema_ok=None) -> dict:
    """Count people. Duplicate addresses merge inside this process and are not listed."""
    grouped: dict[str, list[dict]] = {}
    skipped = {"privacy_withdrawal": 0, "invalid": 0, "identity_missing": 0}
    page_count = 0
    for page in pages or []:
        page_count += 1
        if not isinstance(page, dict) or not isinstance(page.get("properties"), dict):
            skipped["invalid"] += 1
            continue
        if _text(page["properties"].get("Source")).lower() == "privacy_withdrawal":
            skipped["privacy_withdrawal"] += 1
            continue
        try:
            scored = score_notion_page(page, schema_ok=schema_ok)
        except ScoreError:
            skipped["identity_missing"] += 1
            continue
        grouped.setdefault(scored["person_key"], []).append(scored)

    by_completeness: dict[str, int] = {}
    by_stage: dict[str, int] = {}
    by_ranking_score: dict[str, int] = {}
    unknown_phone = 0
    unknown_payment = 0
    sms_consent_counts: dict[str, int] = {}
    product_inferred = 0
    won_dispute_note = 0
    people = 0
    for rows in grouped.values():
        people += 1
        if len(rows) == 1:
            chosen = rows[0]
        else:
            chosen = _merge_scored(rows)
        completeness = chosen["completeness"] or "none"
        by_completeness[completeness] = by_completeness.get(completeness, 0) + 1
        stage = chosen["stage"] or "none"
        by_stage[stage] = by_stage.get(stage, 0) + 1
        ranking = chosen["ranking_score"]
        label = "none" if ranking is None else str(ranking)
        by_ranking_score[label] = by_ranking_score.get(label, 0) + 1
        consent = chosen.get("sms_marketing_consent") or "unknown"
        sms_consent_counts[consent] = sms_consent_counts.get(consent, 0) + 1
        if chosen["phone_contribution"] == "unknown":
            unknown_phone += 1
        if chosen["payment_contribution"] == "unknown":
            unknown_payment += 1
        notes = chosen.get("notes") or []
        if "product_code_inferred_from_reservation_contract" in notes:
            product_inferred += 1
        if "won_dispute_counts_in_scorer_and_not_in_collect_kr_paid_class" in notes:
            won_dispute_note += 1

    report = {
        "pages": page_count,
        "people": people,
        "skipped": skipped,
        "by_completeness": by_completeness,
        "by_stage": by_stage,
        "by_ranking_score": by_ranking_score,
        "unknown_phone": unknown_phone,
        "unknown_payment": unknown_payment,
        "sms_marketing_consent_counts": sms_consent_counts,
        "product_code_inferred_from_reservation_contract": product_inferred,
        "won_dispute_differs_from_collect_kr": won_dispute_note,
        "phone_ownership_verified": False,
        "limitations": [
            "People are merged with a hash of the canonical email. The hash is not in this report.",
            "A page with no email is its own person, keyed by the Notion page id, also omitted here.",
            "The reservation product column is not in the fetch schema. A qualifying 300-cent USD live row infers watchdive_reservation_fee.",
            "Unknown phone is a missing Phone column. An empty Phone cell is absent. SMS marketing consent is counted separately and does not change the phone stage.",
            "This whole-waitlist count is not the creative campaign cohort.",
            "No Meta event is sent from this aggregate.",
        ],
    }
    if "@" in json.dumps(report):
        raise ScoreError("aggregate report contains a contact string")
    return report


def _merge_scored(rows: list[dict]) -> dict:
    """Keep the highest complete stage for one person.

    A suspect or suppressed row removes the person from ranking. A complete
    score of 30 is final. Any other partial row can still raise the score.
    """
    if any(row["completeness"] == "excluded" for row in rows):
        return next(row for row in rows if row["completeness"] == "excluded")
    complete = [row for row in rows if row["completeness"] == "complete" and row["ranking_score"] is not None]
    if complete:
        best = max(complete, key=lambda row: row["ranking_score"])
        partial = [row for row in rows if row["completeness"] == "partial"]
        if partial and best["ranking_score"] < 30:
            return {
                **best,
                "score": None,
                "ranking_score": None,
                "completeness": "partial",
                "lower_bound": best["ranking_score"],
                "notes": list(best.get("notes") or []) + ["merged_unknown_can_raise_stage"],
            }
        notes = []
        for row in rows:
            notes.extend(row.get("notes") or [])
        merged = dict(best)
        merged["notes"] = notes
        return merged
    excluded = [row for row in rows if row["completeness"] == "excluded"]
    if excluded and len(excluded) == len(rows):
        return excluded[0]
    partial = [row for row in rows if row["lower_bound"] is not None]
    if partial:
        floor = max(row["lower_bound"] for row in partial)
        chosen = dict(partial[0])
        chosen["lower_bound"] = floor
        chosen["completeness"] = "partial"
        chosen["score"] = None
        chosen["ranking_score"] = None
        return chosen
    return rows[0]
