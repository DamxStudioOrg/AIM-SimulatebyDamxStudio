"""Deterministic what-if previews over a recorded match.

Replays the recorded allocations twice from the same seed — once as
recorded, once with one turn's allocation swapped — and reports the
score delta. Policies and interventions are not replayed; the
preview isolates the allocation choice only. No provider is called
and no token budget is consumed.
"""

from __future__ import annotations

from aim_sim.models import TURNS, AgentAction
from aim_sim.scoring import full_scores
from aim_sim.simulator import ResilientCitySim


def _replay(seed: int, allocations: list[dict[str, float] | None]) -> dict[str, float]:
    sim = ResilientCitySim(seed)
    for allocation in allocations:
        if allocation is None:
            sim.step(None)
        else:
            sim.step(AgentAction.from_untrusted({"allocation": allocation}))
    scores = full_scores(sim, 0)
    # Efficiency divides by token spend, which a preview does not burn.
    return {key: value for key, value in scores.items() if key != "efficiency"}


def what_if(
    seed: int,
    allocations: list[dict[str, float] | None],
    turn: int,
    allocation: dict[str, float],
) -> dict[str, object]:
    """Score delta from swapping one turn's allocation.

    `turn` is 1-based. `allocations` is the recorded per-turn
    allocation list (None for skipped turns). Raises
    InvalidActionError for a malformed hypothetical and ValueError
    for a turn outside the recorded match.
    """
    if len(allocations) != TURNS:
        msg = f"expected {TURNS} recorded allocations, got {len(allocations)}"
        raise ValueError(msg)
    if not 1 <= turn <= TURNS:
        msg = f"turn must be within 1..{TURNS}, got {turn}"
        raise ValueError(msg)
    # Validate the hypothetical before replaying anything.
    AgentAction.from_untrusted({"allocation": allocation})
    variant = list(allocations)
    variant[turn - 1] = allocation
    baseline = _replay(seed, allocations)
    swapped = _replay(seed, variant)
    return {
        "turn": turn,
        "baseline": baseline,
        "variant": swapped,
        "impact_delta": swapped["impact"] - baseline["impact"],
    }
