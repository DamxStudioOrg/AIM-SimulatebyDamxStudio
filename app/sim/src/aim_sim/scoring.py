"""Scoring for Resilient City Steward: Impact and Efficiency boards."""

from __future__ import annotations

from typing import TYPE_CHECKING

from aim_sim.models import ALLOCATION_KEYS
from aim_sim.simulator import (
    BASE_QUARTERLY_INCOME,
    MAX_RESERVE_RATIO,
    ResilientCitySim,
)

if TYPE_CHECKING:
    from aim_sim.models import TurnLog

WEIGHT_WELLBEING = 0.25
WEIGHT_LIVES = 0.30
WEIGHT_INFRA = 0.20
WEIGHT_EMISSIONS = 0.15
WEIGHT_FISCAL = 0.10
DOLLAR_SCALE = 500_000.0
TOKEN_SCALE = 15_000.0
FISCAL_RESERVE_UNIT = 5_000.0
FISCAL_DEBT_UNIT = 2_000.0
FISCAL_BASELINE = 50.0


def subscores(sim: ResilientCitySim) -> dict[str, float]:
    """Five 0-100 sub-scores from the finished simulator state."""
    lives_lost = sum(sim.lives_lost_by_kind.values())
    if sim.total_exposed > 0:
        lives = 100.0 * sim.lives_stabilized / sim.total_exposed
    else:
        lives = 100.0 if lives_lost == 0 else 0.0
    infra_mean = sum(d.infra_pct for d in sim.districts.values()) / len(sim.districts)
    emissions_cut = max(0.0, min(100.0, -sim.emissions_delta))
    fiscal = (
        FISCAL_BASELINE
        + sim.reserves / FISCAL_RESERVE_UNIT
        - sim.debt / FISCAL_DEBT_UNIT
    )
    return {
        "wellbeing": round(max(0.0, min(100.0, sim.wellbeing)), 2),
        "lives": round(max(0.0, min(100.0, lives)), 2),
        "infra": round(max(0.0, min(100.0, infra_mean)), 2),
        "emissions": round(emissions_cut, 2),
        "fiscal": round(max(0.0, min(100.0, fiscal)), 2),
    }


def impact(sub: dict[str, float]) -> float:
    """Weighted raw impact from sub-scores."""
    return round(
        WEIGHT_WELLBEING * sub["wellbeing"]
        + WEIGHT_LIVES * sub["lives"]
        + WEIGHT_INFRA * sub["infra"]
        + WEIGHT_EMISSIONS * sub["emissions"]
        + WEIGHT_FISCAL * sub["fiscal"],
        2,
    )


def efficiency(impact_score: float, dollars: float, tokens: int) -> float:
    """Impact per cost. Higher spend or token burn dilutes the same impact."""
    return round(
        impact_score / (1.0 + dollars / DOLLAR_SCALE + tokens / TOKEN_SCALE), 2
    )


def full_scores(sim: ResilientCitySim, tokens_used: int) -> dict[str, float]:
    """Sub-scores plus both boards for a finished match."""
    sub = subscores(sim)
    impact_score = impact(sub)
    return {
        **sub,
        "impact": impact_score,
        "efficiency": efficiency(impact_score, sim.spend_total, tokens_used),
    }


BADGE_CLEAN_SHEET = "clean_sheet"
BADGE_FULL_COFFERS = "full_coffers"
BADGE_GREEN_SHIFT = "green_shift"
GREEN_SHIFT_CUT = 5.0


def badges(sim: ResilientCitySim) -> list[str]:
    """Achievement badges for a finished city: no deaths, full coffers, green."""
    earned: list[str] = []
    if sum(sim.lives_lost_by_kind.values()) == 0:
        earned.append(BADGE_CLEAN_SHEET)
    if sim.reserves >= BASE_QUARTERLY_INCOME * MAX_RESERVE_RATIO:
        earned.append(BADGE_FULL_COFFERS)
    if sim.emissions_delta <= -GREEN_SHIFT_CUT:
        earned.append(BADGE_GREEN_SHIFT)
    return earned


def strategy_fingerprint(turns: list[TurnLog]) -> dict[str, object]:
    """Mean allocation profile plus policy counts for diversity analysis.

    Recorded, not scored: a future diversity pass compares fingerprints
    across a population to reward unusual strategies.
    """
    played = [log.action for log in turns if log.action is not None]
    mean: dict[str, float] = dict.fromkeys(ALLOCATION_KEYS, 0.0)
    policies: dict[str, int] = {}
    for action in played:
        for key in ALLOCATION_KEYS:
            mean[key] += action.allocation[key]
        for name in action.policies:
            policies[name] = policies.get(name, 0) + 1
    if played:
        for key in ALLOCATION_KEYS:
            mean[key] = round(mean[key] / len(played), 2)
    return {
        "mean_allocation": mean,
        "policies": policies,
        "played_turns": len(played),
        "skipped_turns": len(turns) - len(played),
    }


def loss_reasons(sim: ResilientCitySim, tokens_used: int) -> list[str]:
    """Computed post-match diagnosis. No narration, only consequences."""
    reasons: list[str] = []
    for kind, deaths in sorted(sim.lives_lost_by_kind.items()):
        reasons.append(f"{deaths} lives lost to {kind}")
    if sim.wasted_idle > 0:
        idle = f"${sim.wasted_idle:,.0f} on rescue/shelter with no crisis to absorb it"
        reasons.append(idle)
    if sim.wasted_overcap > 0:
        cap = BASE_QUARTERLY_INCOME * MAX_RESERVE_RATIO
        over = f"${sim.wasted_overcap:,.0f} reserves parked above the ${cap:,.0f} cap"
        reasons.append(over)
    if sim.debt > 0:
        reasons.append(f"${sim.debt:,.0f} debt carried at final whistle")
    if sim.skipped_turns > 0:
        reasons.append(f"{sim.skipped_turns} skipped turns (invalid or missing moves)")
    if tokens_used >= TOKEN_SCALE:
        reasons.append(f"{tokens_used} tokens burned against a 15,000 budget")
    if not reasons:
        reasons.append("clean sheet: no deaths, waste, debt, or skipped turns")
    return reasons
