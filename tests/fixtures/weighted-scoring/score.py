"""Highest-stage WatchDive score. Offline, no network, no contact fields.

The score is the single highest stage that is still true. Stages the person
passed through are not added. Unknown inputs stay unknown and are never
reported as zero.
"""

from __future__ import annotations

import json
from pathlib import Path

POLICY_PATH = Path(__file__).with_name("scoring-policy.json")

FORBIDDEN_KEYS = {
    "email",
    "phone",
    "phone_number",
    "mobile",
    "e164",
    "em",
    "ph",
    "name",
    "first_name",
    "last_name",
    "raw",
    "hash",
    "sha256",
}


class ScoreError(ValueError):
    """The input broke the contract. Nothing was scored."""


def load_policy(path: Path | None = None) -> dict:
    raw = json.loads((path or POLICY_PATH).read_text(encoding="utf-8"))
    weights = raw["weights"]
    if list(weights) != [
        "email_signup",
        "email_verified",
        "phone_without_verified_email",
        "verified_email_and_phone",
        "paid_reservation",
    ]:
        raise ScoreError("policy weights drifted")
    if [weights[name] for name in weights] != [1, 3, 5, 10, 30]:
        raise ScoreError("policy weights are not 1, 3, 5, 10, 30")
    if raw["aggregation"] != "highest_currently_true_stage":
        raise ScoreError("policy aggregation is not highest stage")
    return raw


POLICY = load_policy()
WEIGHTS: dict[str, int] = dict(POLICY["weights"])
CONSENT_VERSION = POLICY["phone_consent_version"]
FEE_CENTS = POLICY["payment"]["amount_cents"]
FEE_CURRENCY = POLICY["payment"]["currency"]
PRODUCT_CODE = POLICY["payment"]["product_code"]


def _reject_contact(value, seen: set[int] | None = None) -> None:
    if seen is None:
        seen = set()
    marker = id(value)
    if marker in seen:
        return
    if isinstance(value, (dict, list)):
        seen.add(marker)
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in FORBIDDEN_KEYS:
                raise ScoreError("contact field refused: " + lowered)
            _reject_contact(item, seen)
    elif isinstance(value, list):
        for item in value:
            _reject_contact(item, seen)
    elif isinstance(value, str):
        if "@" in value or value.startswith("+"):
            raise ScoreError("contact-shaped string refused")


def _blank_result(person_key: str) -> dict:
    return {
        "person_key": person_key,
        "score": None,
        "lower_bound": None,
        "completeness": "invalid",
        "stage": None,
        "applicable_stages": [],
        "unknown_fields": [],
        "phone_contribution": "not_qualified",
        "phone_ownership_verified": False,
        "payment_contribution": "not_qualified",
        "reasons": [],
        "ranking_score": None,
    }


def parse_sms_consent(record) -> str:
    """Return granted, missing, withdrawn, or unknown. Never a phone number."""
    if record is None or record == "":
        return "missing"
    if record == "unknown":
        return "unknown"
    if not isinstance(record, str):
        raise ScoreError("sms consent must be a string marker or unknown")
    _reject_contact(record)
    lowered = record.lower()
    if "withdrawn" in lowered:
        return "withdrawn"
    if CONSENT_VERSION in record:
        return "granted"
    return "missing"


def payment_qualification(payment: dict | None) -> str:
    """qualified, not_qualified, or unknown."""
    if payment is None:
        return "unknown"
    _reject_contact(payment)
    if payment.get("loaded") is False:
        return "unknown"
    status = payment.get("status", "none")
    if status == "unknown" or payment.get("livemode") is None or payment.get("webhook_verified") is None:
        return "unknown"
    if status in (None, "none", "unpaid"):
        return "not_qualified"
    if status != "paid":
        return "not_qualified"
    if payment.get("livemode") is not True or payment.get("mode") == "test":
        return "not_qualified"
    if payment.get("webhook_verified") is not True:
        return "not_qualified"
    if payment.get("amount_cents") != FEE_CENTS:
        return "not_qualified"
    if str(payment.get("currency", "")).lower() != FEE_CURRENCY:
        return "not_qualified"
    if payment.get("product_code") != PRODUCT_CODE:
        return "not_qualified"
    refund_state = payment.get("refund_state", "none")
    if refund_state != "none":
        return "not_qualified"
    dispute = payment.get("dispute", "none")
    if dispute not in ("none", "won"):
        return "not_qualified"
    return "qualified"


def sms_marketing_consent(facts: dict) -> str:
    """Marketing permission only. It does not decide the phone stage."""
    consent = facts.get("sms_consent")
    if consent is None and "sms_consent_record" in facts:
        consent = parse_sms_consent(facts.get("sms_consent_record"))
    if facts.get("sms_consent_loaded") is False or consent == "unknown":
        return "unknown"
    if consent in (None, "", "missing"):
        return "missing"
    if consent == "withdrawn":
        return "withdrawn"
    if consent == "granted" or (isinstance(consent, str) and CONSENT_VERSION in consent):
        return "granted"
    return "missing"


def phone_qualification(facts: dict) -> str:
    """A voluntarily saved phone. SMS marketing consent is not a qualifier."""
    state = facts.get("phone_state", "unknown")
    if facts.get("phone_loaded") is False or state == "unknown":
        return "unknown"
    if state in (None, "absent"):
        return "not_qualified"
    if state != "saved":
        raise ScoreError("phone_state must be saved, absent, or unknown")
    email_state = facts.get("email_state")
    if email_state == "none" and facts.get("phone_only_lead_valid") is not True:
        return "not_qualified"
    return "qualified"


def _normalize(facts: dict) -> dict:
    _reject_contact(facts)
    person_key = facts.get("person_key")
    if not isinstance(person_key, str) or not person_key.strip():
        raise ScoreError("person_key is required")
    email_state = facts.get("email_state", "unknown")
    if email_state not in ("unknown", "none", "signup", "verified"):
        raise ScoreError("email_state is not a known enum")
    if facts.get("email_loaded") is False:
        email_state = "unknown"
    payment = facts.get("payment")
    payments = facts.get("payments")
    if payments is not None:
        if not isinstance(payments, list):
            raise ScoreError("payments must be a list")
        states = [payment_qualification(item) for item in payments]
        if "qualified" in states:
            payment_state = "qualified"
        elif "unknown" in states:
            payment_state = "unknown"
        else:
            payment_state = "not_qualified"
    else:
        payment_state = payment_qualification(payment)
    phone_state = phone_qualification({**facts, "email_state": email_state})
    excluded = facts.get("excluded")
    if excluded not in (None, "suspect", "suppressed"):
        raise ScoreError("excluded must be suspect, suppressed, or null")
    return {
        "person_key": person_key,
        "email_state": email_state,
        "phone_state": phone_state,
        "payment_state": payment_state,
        "excluded": excluded,
        "phone_only_rejected": (
            email_state == "none"
            and facts.get("phone_state") == "saved"
            and facts.get("phone_only_lead_valid") is not True
        ),
        "sms_marketing_consent": sms_marketing_consent(facts),
    }


def _proven_stages(email_state: str, phone_state: str, payment_state: str) -> list[str]:
    stages: list[str] = []
    if email_state in ("signup", "verified"):
        stages.append("email_signup")
    if email_state == "verified":
        stages.append("email_verified")
    if phone_state == "qualified" and email_state == "verified":
        stages.append("verified_email_and_phone")
    if phone_state == "qualified" and email_state in ("signup", "none"):
        stages.append("phone_without_verified_email")
    if payment_state == "qualified":
        stages.append("paid_reservation")
    return stages


def _ceiling(email_state: str, phone_state: str, payment_state: str, proven_max: int | None) -> int | None:
    candidates = []
    if proven_max is not None:
        candidates.append(proven_max)
    if payment_state == "unknown":
        candidates.append(WEIGHTS["paid_reservation"])
    if phone_state == "unknown":
        if email_state == "verified":
            candidates.append(WEIGHTS["verified_email_and_phone"])
        elif email_state == "signup":
            candidates.append(WEIGHTS["phone_without_verified_email"])
        elif email_state in ("unknown", "none"):
            candidates.append(WEIGHTS["phone_without_verified_email"])
            if email_state == "unknown":
                candidates.append(WEIGHTS["verified_email_and_phone"])
    if email_state == "unknown" and phone_state == "qualified":
        candidates.append(WEIGHTS["verified_email_and_phone"])
    if email_state == "unknown" and phone_state != "qualified" and payment_state != "qualified":
        candidates.append(WEIGHTS["email_verified"])
    if not candidates:
        return None
    return max(candidates)


def score_snapshot(facts: dict) -> dict:
    """Score one redacted person snapshot. Highest true stage, never a sum."""
    normalized = _normalize(facts)
    result = _blank_result(normalized["person_key"])
    result["phone_contribution"] = normalized["phone_state"]
    result["sms_marketing_consent"] = normalized["sms_marketing_consent"]
    result["sms_marketing_consent_affects_score"] = False
    result["payment_contribution"] = normalized["payment_state"]
    if normalized["phone_only_rejected"]:
        result["reasons"].append("phone_only_lead_not_valid")
    if normalized["excluded"]:
        result["completeness"] = "excluded"
        result["reasons"].append(normalized["excluded"])
        return result

    unknown = []
    if normalized["email_state"] == "unknown":
        unknown.append("email_state")
    if normalized["phone_state"] == "unknown":
        unknown.append("phone_state")
    if normalized["payment_state"] == "unknown":
        unknown.append("payment")
    stages = _proven_stages(
        normalized["email_state"], normalized["phone_state"], normalized["payment_state"]
    )
    result["applicable_stages"] = stages
    proven_values = [WEIGHTS[name] for name in stages]
    proven_max = max(proven_values) if proven_values else None
    ceiling = _ceiling(
        normalized["email_state"],
        normalized["phone_state"],
        normalized["payment_state"],
        proven_max,
    )
    result["unknown_fields"] = unknown
    result["lower_bound"] = proven_max

    payment_locks_score = normalized["payment_state"] == "qualified"
    unknowns_cannot_raise = proven_max is not None and ceiling == proven_max
    nothing_possible = proven_max is None and ceiling is None
    if payment_locks_score or unknowns_cannot_raise or nothing_possible:
        result["score"] = proven_max
        result["completeness"] = "complete" if not unknown else "partial"
        if payment_locks_score:
            result["completeness"] = "complete"
            result["reasons"].append("payment_stage_does_not_depend_on_other_states")
        elif nothing_possible:
            result["reasons"].append("no_qualifying_stage")
        if unknown and payment_locks_score:
            result["reasons"].append("unknown_fields_remain_but_cannot_raise_score")
    else:
        result["score"] = None
        result["completeness"] = "partial"
        result["reasons"].append("unknown_can_raise_stage")
    if result["score"] is not None:
        result["stage"] = max(stages, key=lambda name: WEIGHTS[name])
    elif proven_max is not None:
        result["stage"] = max(stages, key=lambda name: WEIGHTS[name])
    result["ranking_score"] = result["score"] if result["completeness"] == "complete" else None
    if result["score"] == 0:
        raise ScoreError("internal score became zero")
    return result


def facts_from_redacted_view(view: dict) -> dict:
    """Map loaded CRM flags onto a snapshot. Missing columns stay unknown."""
    _reject_contact(view)
    person_key = view.get("person_key")
    if not isinstance(person_key, str) or not person_key.strip():
        raise ScoreError("person_key is required")
    excluded = None
    if view.get("suspect") is True:
        excluded = "suspect"
    elif view.get("status") == "suppressed":
        excluded = "suppressed"

    if view.get("email_loaded") is False:
        email_state = "unknown"
    elif view.get("email_present") is not True:
        email_state = "none"
    elif view.get("email_verified") is True or view.get("status") == "verified" or view.get("verified_at_set") is True:
        email_state = "verified"
    else:
        email_state = "signup"

    if view.get("phone_loaded") is False:
        phone_state = "unknown"
    elif view.get("phone_present") is not True:
        phone_state = "absent"
    else:
        phone_state = "saved"
    if view.get("sms_consent_loaded") is False:
        sms_consent = "unknown"
    else:
        sms_consent = parse_sms_consent(view.get("sms_consent_record"))

    paid_flag = view.get("reservation_paid") is True
    mode = view.get("reservation_mode")
    if view.get("payment_loaded") is False:
        payment = {"loaded": False}
    elif paid_flag and (mode is None or view.get("webhook_verified") is None):
        payment = {"loaded": False}
    elif not paid_flag and mode is None and view.get("amount_cents") is None:
        payment = {
            "loaded": True,
            "status": "none",
            "livemode": True,
            "webhook_verified": True,
        }
    else:
        dispute = view.get("dispute") or "none"
        refunded = int(view.get("refunded_cents") or 0)
        pending = int(view.get("refund_pending_cents") or 0)
        if pending > 0:
            refund_state = "pending"
        elif refunded >= FEE_CENTS:
            refund_state = "full"
        elif refunded > 0:
            refund_state = "partial"
        else:
            refund_state = "none"
        payment = {
            "loaded": True,
            "status": "paid" if paid_flag else "none",
            "livemode": mode == "live",
            "mode": mode or "test",
            "webhook_verified": view.get("webhook_verified") is True,
            "amount_cents": view.get("amount_cents"),
            "currency": view.get("currency"),
            "product_code": view.get("product_code"),
            "refund_state": refund_state,
            "dispute": dispute,
            "payment_id": view.get("payment_id"),
        }

    return {
        "person_key": person_key,
        "email_state": email_state,
        "email_loaded": email_state != "unknown",
        "phone_state": phone_state,
        "phone_loaded": phone_state != "unknown",
        "sms_consent": sms_consent,
        "sms_consent_loaded": sms_consent != "unknown",
        "phone_only_lead_valid": view.get("phone_only_lead_valid") is True,
        "payment": payment,
        "excluded": excluded,
    }


def _clean_payment(payment_id: str = "merged") -> dict:
    return {
        "loaded": True,
        "status": "paid",
        "livemode": True,
        "mode": "live",
        "webhook_verified": True,
        "amount_cents": FEE_CENTS,
        "currency": FEE_CURRENCY,
        "product_code": PRODUCT_CODE,
        "refund_state": "none",
        "dispute": "none",
        "payment_id": payment_id,
    }


def _payment_items(facts: dict) -> list[dict | None]:
    if facts.get("payments") is not None:
        return list(facts["payments"])
    if "payment" in facts:
        return [facts.get("payment")]
    return [None]


def merge_snapshots(snapshots: list[dict]) -> dict:
    """Merge duplicate rows for one person. A known qualifying fact beats unknown.

    Each row is qualified on its own, then the qualifications are merged.
    SMS marketing consent is merged as metadata and does not gate the phone.
    """
    if not snapshots:
        raise ScoreError("nothing to merge")
    _reject_contact(snapshots)
    keys = {item.get("person_key") for item in snapshots}
    if len(keys) != 1 or None in keys:
        raise ScoreError("merge requires one person_key")
    person_key = snapshots[0]["person_key"]
    email_rank = {"unknown": 0, "none": 1, "signup": 2, "verified": 3}
    emails = [item.get("email_state", "unknown") for item in snapshots]
    for value in emails:
        if value not in email_rank:
            raise ScoreError("email_state is not a known enum")
    best_email = max(emails, key=lambda value: email_rank[value])
    if best_email == "none" and "unknown" in emails:
        best_email = "unknown"

    phone_values = [phone_qualification(item) for item in snapshots]
    consents = [sms_marketing_consent(item) for item in snapshots]
    if "granted" in consents:
        sms_consent = "granted"
    elif "withdrawn" in consents:
        sms_consent = "withdrawn"
    elif "missing" in consents:
        sms_consent = "missing"
    else:
        sms_consent = "unknown"
    if "qualified" in phone_values:
        phone_state, phone_only = "saved", True
    elif "unknown" in phone_values:
        phone_state, phone_only = "unknown", False
    else:
        phone_state, phone_only = "absent", False

    by_id: dict[str, set[str]] = {}
    saw_missing_payment = False
    anonymous: list[str] = []
    for item in snapshots:
        for payment in _payment_items(item):
            if payment is None:
                saw_missing_payment = True
                continue
            state = payment_qualification(payment)
            payment_id = payment.get("payment_id")
            if payment_id:
                by_id.setdefault(str(payment_id), set()).add(state)
            else:
                anonymous.append(state)
    payment_states = set(anonymous)
    for states in by_id.values():
        if len(states) > 1:
            payment_states.add("unknown")
        else:
            payment_states.update(states)
    if saw_missing_payment and "qualified" not in payment_states:
        payment_states.add("unknown")
    if "qualified" in payment_states:
        payment_field = _clean_payment()
    elif "unknown" in payment_states or not payment_states:
        payment_field = {"loaded": False}
    else:
        payment_field = {
            "loaded": True,
            "status": "none",
            "livemode": True,
            "webhook_verified": True,
        }
    excluded = None
    for item in snapshots:
        if item.get("excluded") in ("suspect", "suppressed"):
            excluded = item["excluded"]
    return score_snapshot(
        {
            "person_key": person_key,
            "email_state": best_email,
            "phone_state": phone_state,
            "phone_loaded": phone_state != "unknown",
            "sms_consent": sms_consent,
            "sms_consent_loaded": sms_consent != "unknown",
            "phone_only_lead_valid": phone_only,
            "payment": payment_field,
            "excluded": excluded,
        }
    )


def fold_history(events: list[dict]) -> dict:
    """Apply ordered transitions for one person, then score the result."""
    if not events:
        raise ScoreError("history is empty")
    _reject_contact(events)
    keys = {event.get("person_key") for event in events}
    if len(keys) != 1:
        raise ScoreError("history must belong to one person")
    person_key = events[0]["person_key"]
    email_state = "none"
    email_loaded = True
    phone_state = "absent"
    phone_loaded = True
    sms_consent = "missing"
    sms_loaded = True
    phone_only = False
    excluded = None
    payments: dict[str, dict] = {}
    for event in events:
        kind = event.get("type")
        if kind == "email_signup":
            if email_state != "verified":
                email_state = "signup"
            email_loaded = True
        elif kind == "email_verified":
            email_state = "verified"
            email_loaded = True
        elif kind == "email_unknown":
            email_state = "unknown"
            email_loaded = False
        elif kind == "phone_saved":
            phone_state = "saved"
            phone_loaded = True
            sms_consent = parse_sms_consent(event.get("sms_consent_record"))
            sms_loaded = sms_consent != "unknown"
        elif kind == "phone_consent_withdrawn":
            sms_consent = "withdrawn"
            sms_loaded = True
        elif kind == "phone_data_withdrawn":
            phone_state = "absent"
            phone_loaded = True
        elif kind == "phone_absent":
            phone_state = "absent"
            phone_loaded = True
            sms_consent = "missing"
        elif kind == "phone_unknown":
            phone_state = "unknown"
            phone_loaded = False
            sms_consent = "unknown"
            sms_loaded = False
        elif kind == "declare_phone_only_lead":
            phone_only = event.get("valid") is True
        elif kind == "exclude":
            if event.get("reason") not in ("suspect", "suppressed"):
                raise ScoreError("exclude reason is not allowed")
            excluded = event["reason"]
        elif kind == "payment":
            payment_id = event.get("payment_id")
            if not isinstance(payment_id, str) or not payment_id:
                raise ScoreError("payment_id is required")
            current = dict(payments.get(payment_id, {}))
            current.update({key: value for key, value in event.items() if key not in ("type", "person_key")})
            current["loaded"] = True
            current.setdefault("status", "paid")
            payments[payment_id] = current
        elif kind == "payment_unknown":
            payments["__unknown__"] = {"loaded": False}
        else:
            raise ScoreError("unknown history event")
    payment_list = list(payments.values())
    facts = {
        "person_key": person_key,
        "email_state": email_state,
        "email_loaded": email_loaded,
        "phone_state": phone_state,
        "phone_loaded": phone_loaded,
        "sms_consent": sms_consent,
        "sms_consent_loaded": sms_loaded,
        "phone_only_lead_valid": phone_only,
        "excluded": excluded,
    }
    if payment_list:
        facts["payments"] = payment_list
    else:
        facts["payment"] = {
            "loaded": True,
            "status": "none",
            "livemode": True,
            "webhook_verified": True,
        }
    return score_snapshot(facts)


def trace_history(events: list[dict]) -> list[dict]:
    """Score the prefix of a history after every event."""
    return [fold_history(events[: index + 1]) for index in range(len(events))]
