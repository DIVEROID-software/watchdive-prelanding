"""Opaque person key. Same folding as crm_score, which matches leads.py.

The address is not returned. An empty result means the address is not a
usable CRM key and the caller must skip the observation.
"""

from __future__ import annotations

import hashlib

from crm_score import _canonical_email


def person_key(email: str) -> str:
    canonical = _canonical_email(email if isinstance(email, str) else "")
    if not canonical:
        return ""
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return "crm:" + digest
