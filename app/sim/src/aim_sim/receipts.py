"""HMAC-signed run receipts: the board trusts sim-witnessed scores only.

When SIM_RECEIPT_SECRET is configured, match and tote payloads carry a
receipt binding the scored fields. The board recomputes the HMAC over
the verbatim payload string and rejects anything unsigned, altered, or
bound to different fields — fabrication then requires the shared
secret, not just the submitter's arena id. With the secret unset
(local play), no receipt is attached and nothing changes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os

RECEIPT_SECRET_ENV = "SIM_RECEIPT_SECRET"  # noqa: S105 -- env var name, not a secret.


def canonical_receipt(payload: dict[str, object]) -> str:
    """Canonical JSON for one receipt payload: sorted keys, tight seals."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def sign_payload(payload: dict[str, object]) -> dict[str, str] | None:
    """Sign one receipt payload, or None when no secret is configured."""
    secret = os.environ.get(RECEIPT_SECRET_ENV, "")
    if not secret:
        return None
    canonical = canonical_receipt(payload)
    sig = hmac.new(
        secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return {"payload": canonical, "sig": sig}
