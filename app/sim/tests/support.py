"""Shared fixtures for sim tests. Canonical valid-action builder lives here."""

from __future__ import annotations

import json

from aim_sim.models import AgentAction

BALANCED_ALLOCATION = {
    "housing": 15.0,
    "transit": 10.0,
    "health": 15.0,
    "green": 10.0,
    "reserves": 15.0,
    "rescue": 12.0,
    "shelter": 11.0,
    "repair": 12.0,
}


def balanced_action() -> AgentAction:
    """A valid action summing to 100 with no policies."""
    return AgentAction.from_untrusted(
        {"allocation": dict(BALANCED_ALLOCATION), "policies": [], "note": ""}
    )


def balanced_json() -> str:
    """The same action as raw model-output JSON."""
    return json.dumps({"allocation": dict(BALANCED_ALLOCATION), "policies": []})
