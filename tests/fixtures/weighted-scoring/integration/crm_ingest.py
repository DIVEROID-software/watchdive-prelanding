"""Plan stage deltas from Notion pages already in memory.

This module does not call Notion, Stripe, or Meta, and it does not copy a
page into the ledger. The Signed up date is the cohort anchor. A page
without that date cannot emit. Test pages stay ineligible unless the caller
explicitly sets the data plane to live.
"""

from __future__ import annotations

from datetime import timedelta

from crm_score import _text, score_notion_page
from score import ScoreError

from .lifecycle import NATIVE_CAMPAIGNS, NATIVE_LIMITATIONS, _aware, decide_person


def _signed_up(page: dict) -> str | None:
    props = page.get("properties")
    if not isinstance(props, dict):
        return None
    prop = props.get("Signed up")
    if not isinstance(prop, dict):
        return None
    date = prop.get("date")
    if not isinstance(date, dict):
        return None
    start = date.get("start")
    if not isinstance(start, str) or "@" in start or start.startswith("+"):
        return None
    if len(start) == 10 and start[4] == "-" and start[7] == "-":
        start = f"{start}T00:00:00+00:00"
    try:
        _aware(start)
    except (TypeError, ValueError):
        return None
    return start


def _campaign_state(props: dict) -> tuple[str | None, bool]:
    meta = _text(props.get("Meta Campaign ID"))
    utm = _text(props.get("UTM Campaign"))
    if meta and utm and meta != utm:
        return None, True
    chosen = meta or utm
    if not chosen:
        return None, False
    if chosen not in NATIVE_CAMPAIGNS:
        return None, True
    return chosen, False


def _page_plane(props: dict, configured: str) -> str:
    environment = _text(props.get("Environment")).strip().lower()
    if environment in {"test", "preview", "development", "staging"}:
        return environment
    if environment == "qa":
        return "test"
    if environment == "live":
        return "live"
    return configured


def plan_from_crm_pages(pages, emissions: list[dict], config: dict) -> dict:
    """Score pages that were already fetched. No network and no new schema."""
    maturity_hours = config.get("maturity_hours", 48)
    if not isinstance(maturity_hours, int) or isinstance(maturity_hours, bool) or maturity_hours <= 0:
        raise ValueError("maturity_hours must be a positive integer")
    now = _aware(config["now"])
    plane = config.get("data_plane") or "staging"
    if plane not in {"live", "test", "preview", "development", "staging", "unknown"}:
        plane = "staging"
    maturity = timedelta(hours=maturity_hours)
    people = []
    skipped = {"privacy_withdrawal": 0, "invalid": 0, "identity_missing": 0, "suppressed": 0, "suspect": 0}
    for page in pages or []:
        if not isinstance(page, dict) or not isinstance(page.get("properties"), dict):
            skipped["invalid"] += 1
            continue
        source = page["properties"].get("Source")
        source_name = ""
        if isinstance(source, dict):
            source_name = str(source.get("rich_text") or source.get("select") or source.get("status") or "")
        source_text = _text(source).strip().lower()
        if (
            "privacy_withdrawal" in source_name.lower()
            or "privacy_withdrawal" in source_text
            or source_text in {"qa", "test"}
        ):
            skipped["privacy_withdrawal"] += 1
            continue
        if _text(page["properties"].get("Verification status")).strip().lower() == "suppressed":
            skipped["suppressed"] += 1
            continue
        suspect = page["properties"].get("Suspect")
        if isinstance(suspect, dict) and suspect.get("checkbox") is True:
            skipped["suspect"] += 1
            continue
        try:
            scored = score_notion_page(page)
        except ScoreError:
            skipped["invalid"] += 1
            continue
        if scored.get("skipped"):
            skipped["privacy_withdrawal"] += 1
            continue
        person = scored.get("person_key")
        if not isinstance(person, str) or len(person) != 68 or not person.startswith("crm:"):
            skipped["identity_missing"] += 1
            continue
        first = _signed_up(page)
        mature = bool(first) and _aware(first) + maturity <= now
        campaign_id, campaign_conflict = _campaign_state(page["properties"])
        state = {
            "person_key": person,
            "first_seen_at": first,
            "saw_signup": first is not None,
            "mature": mature,
            "measurement": scored.get("measurement_consent") or "unknown",
            "data_plane": _page_plane(page["properties"], plane),
            "campaign_id": campaign_id,
            "campaign_conflict": campaign_conflict,
            "sources": ["crm"],
            "ranking_score": scored.get("ranking_score"),
            "completeness": scored.get("completeness"),
            "stage": scored.get("stage"),
            "internal_score": scored.get("score"),
            "payment_qualified": scored.get("payment_contribution") == "qualified",
            "sms_marketing_consent": scored.get("sms_marketing_consent"),
            "phone_contribution": scored.get("phone_contribution"),
        }
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
        "skipped": skipped,
        "source": "crm",
    }
