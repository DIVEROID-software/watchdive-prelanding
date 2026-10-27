"""Dry-run planner for the stage-score ledger.

Reads an existing SQLite file. It does not call Meta, Notion, or Stripe.
Without --flush it does not write. --flush records a simulation row in
stage_simulation and does not mark the live outbox sent. The sender stays
in the disabled delivery adapter.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

from .crm_ingest import plan_from_crm_pages
from .ledger import LedgerError, assert_ledger_path, connect, load_observations, load_plan_emissions
from .lifecycle import assert_export_is_dry_run, plan_observations, record_simulation


def _fail(message: str) -> int:
    if "@" in message:
        message = "refused"
    print(message, file=sys.stderr)
    return 2


def _counts(connection: sqlite3.Connection) -> dict:
    sent = connection.execute(
        """
        SELECT COALESCE(SUM(CAST(delta_value AS INTEGER)), 0) AS total, COUNT(*) AS n
        FROM stage_outbox WHERE status = 'sent'
        """
    ).fetchone()
    outbox = connection.execute("SELECT COUNT(*) AS n FROM stage_outbox").fetchone()
    simulated = connection.execute(
        """
        SELECT COALESCE(SUM(CAST(delta_value AS INTEGER)), 0) AS total, COUNT(*) AS n
        FROM stage_simulation
        """
    ).fetchone()
    legacy = connection.execute(
        "SELECT COUNT(*) AS n FROM stage_emission WHERE status = 'flushed'"
    ).fetchone()
    return {
        "live_sent_sum": int(sent["total"]),
        "live_sent_rows": int(sent["n"]),
        "live_outbox_rows": int(outbox["n"]),
        "simulated_value_sum": int(simulated["total"]),
        "simulated_rows": int(simulated["n"]),
        "legacy_flushed_rows": int(legacy["n"]),
    }


def _summary(planned: dict, *, applied: bool, counts: dict) -> dict:
    people = planned["people"]
    reasons: Counter[str] = Counter()
    for person in people:
        reasons.update(person.get("reasons") or [])
    purchase_values = sorted(
        {
            person["purchase_shape"]["custom_data"]["value"]
            for person in people
            if person.get("purchase_shape")
        }
    )
    if any(value != "3.00" for value in purchase_values):
        raise RuntimeError("purchase export drifted")
    if any((person.get("purchase_shape") or {}).get("send") for person in people):
        raise RuntimeError("purchase send flag drifted")
    deltas = [person["desired"]["delta_value"] for person in people if person.get("desired")]
    if any("." in str(delta) for delta in deltas):
        raise RuntimeError("stage delta formatted as money")
    return {
        "send": False,
        "network": False,
        "native_per_person_max": False,
        "people": len(people),
        "eligible": sum(1 for person in people if person["eligible"]),
        "armed_value_sum": planned["armed_value_sum"],
        "flushed_value_sum": counts["live_sent_sum"],
        "flushed_rows": counts["live_sent_rows"],
        "live_sent_sum": counts["live_sent_sum"],
        "live_outbox_rows": counts["live_outbox_rows"],
        "simulated_value_sum": counts["simulated_value_sum"],
        "simulated_rows": counts["simulated_rows"],
        "legacy_flushed_rows": counts["legacy_flushed_rows"],
        "overstatement_people": sum(1 for person in people if person["overstatement"]),
        "overstatement_points": sum(person["overstatement"] for person in people),
        "purchase_shapes": sum(1 for person in people if person.get("purchase_shape")),
        "purchase_values": purchase_values,
        "purchase_send": False,
        "stage_deltas": deltas,
        "reason_counts": dict(sorted(reasons.items())),
        "applied": applied,
        "flushed": False,
        "skipped": planned.get("skipped"),
        "source": planned.get("source", "ledger"),
    }


def _connect_readonly(file: str) -> sqlite3.Connection:
    path = assert_ledger_path(file)
    if not path.is_file():
        raise LedgerError("ledger file is missing")
    uri = f"file:{path.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("SELECT 1 FROM stage_observation").fetchone()
    return connection


def build_plan(connection: sqlite3.Connection, args: argparse.Namespace, pages) -> dict:
    emissions = load_plan_emissions(connection)
    config = {
        "now": args.now,
        "cohort_start": args.cohort_start,
        "export_mode": args.export,
        "maturity_hours": args.maturity_hours,
        "data_plane": args.data_plane,
    }
    if pages is not None:
        return plan_from_crm_pages(pages, emissions, config)
    return plan_observations(load_observations(connection), emissions, config)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dry-run WatchDiveStageScore planner")
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--now", required=True)
    parser.add_argument("--cohort-start", required=True)
    parser.add_argument("--data-plane", default="staging")
    parser.add_argument("--export", default="dry-run", choices=("dry-run", "live", "off"))
    parser.add_argument("--maturity-hours", type=int, default=48)
    parser.add_argument("--pages")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--flush",
        action="store_true",
        help="record a simulation only; does not mark the live outbox sent",
    )
    parser.add_argument("--include-keys", action="store_true")
    args = parser.parse_args(argv)
    if args.flush:
        args.apply = True
    if args.apply and args.export != "dry-run":
        return _fail("refusing to write unless export is dry-run")
    if args.data_plane != "live" and args.apply:
        return _fail("refusing to write unless data plane is live")
    try:
        assert_ledger_path(args.ledger)
    except LedgerError as error:
        return _fail(str(error))
    pages = None
    if args.pages:
        try:
            pages = json.loads(Path(args.pages).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return _fail("pages file is not readable json")
        if not isinstance(pages, list):
            return _fail("pages file must be a list")
    try:
        if args.apply:
            connection = connect(args.ledger)
        else:
            connection = _connect_readonly(args.ledger)
        planned = build_plan(connection, args, pages)
        assert_export_is_dry_run(json.dumps(planned))
        applied = False
        if args.flush:
            result = record_simulation(connection, planned, args.now)
            applied = True
            if result["network"] is not False or result["flushed"] != 0:
                raise RuntimeError("flush claimed a live send")
        summary = _summary(planned, applied=applied, counts=_counts(connection))
        if args.include_keys:
            summary["people"] = planned["people"]
        blob = json.dumps(summary, sort_keys=True)
        if isinstance(summary.get("people"), list):
            assert_export_is_dry_run(blob)
        if "@" in blob:
            return _fail("refused")
        print(blob)
        return 0
    except (LedgerError, RuntimeError, ValueError, sqlite3.Error) as error:
        return _fail(error.__class__.__name__)
    finally:
        if "connection" in locals():
            connection.close()


if __name__ == "__main__":
    sys.exit(main())
