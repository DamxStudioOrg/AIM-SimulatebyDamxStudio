"""Tote-packing game: deterministic single-shot prompt challenge.

The agent submits one JSON packing list (bottom-to-top item order) for a
seeded catalog. The sim validates the list and scores it from item values
minus damage: overweight strain, crush load on fragile items, and pairwise
reactions (liquid over fabric stains, sharp over rope cuts).

Calibration (sim 0.1.0, headless probe seeds 1-10): a sharp ordering
(heavies bottom, liquids low, fragile top, rope above the saw) beats a
naive first-five ordering on every seed; the deterministic test double
packs the offered draw in order, ignoring prompt text exactly like its
fixed city allocation.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass

from aim_sim.models import MatchConfig
from aim_sim.runner import (
    ModelProvider,
    PromptTooLongError,
    count_words,
    estimate_tokens,
    usage_anomaly,
)

CAPACITY_KG = 10.0
OFFER_COUNT = 10
SCARCE_COUNT = 2
FREE_SLOTS = 2
BADGE_BONUS = 0.5
SCARCE_BONUS = 0.5
TOTE_REPLY_SHAPE = (
    'Reply with JSON only, exactly this shape: {"packing": '
    "[<item ids bottom-to-top>]}. Use offered ids; up to 2 ids may be "
    "non-offered catalog items (free slots)."
)
OVERWEIGHT_RATE = 2.0
CRUSH_RATE = 0.4
STAIN_COST = 3.0
CUT_COST = 2.0
BADGE_LIGHT_PACK = "light_pack"
BADGE_FRAGILE_TOP = "fragile_top3"
BADGE_SPOTLESS = "spotless"
FRAGILE_TOP_SLOTS = 3


@dataclass(frozen=True)
class ToteItem:
    """One packable: weight strains the bag, tags drive reactions."""

    id: str
    label: str
    weight: float
    value: float
    fragile: bool
    tags: tuple[str, ...]


MASTER_CATALOG: tuple[ToteItem, ...] = (
    ToteItem("hammer", "Claw hammer", 1.2, 6.0, fragile=False, tags=()),
    ToteItem("wrench", "Wrench", 0.8, 5.0, fragile=False, tags=()),
    ToteItem("saw", "Hand saw", 1.5, 7.0, fragile=False, tags=("sharp",)),
    ToteItem("drill", "Drill", 1.8, 8.0, fragile=False, tags=()),
    ToteItem("level", "Level", 0.6, 4.0, fragile=False, tags=()),
    ToteItem("tape", "Tape measure", 0.2, 2.0, fragile=False, tags=()),
    ToteItem("rope", "Rope coil", 1.0, 4.0, fragile=False, tags=()),
    ToteItem("nails", "Box of nails", 0.9, 3.0, fragile=False, tags=("sharp",)),
    ToteItem("paint", "Paint can", 2.5, 6.0, fragile=False, tags=("liquid",)),
    ToteItem("lumber", "Lumber", 3.0, 7.0, fragile=False, tags=()),
    ToteItem("tarp", "Tarp", 0.7, 3.0, fragile=False, tags=("fabric",)),
    ToteItem("sandpaper", "Sandpaper", 0.1, 1.0, fragile=False, tags=()),
    ToteItem("glue", "Glue bottle", 0.4, 3.0, fragile=False, tags=("liquid",)),
    ToteItem("bolts", "Bolts jar", 1.1, 4.0, fragile=False, tags=()),
    ToteItem("eggs", "Eggs", 0.5, 5.0, fragile=True, tags=()),
    ToteItem("glassjar", "Glass jar", 0.6, 5.0, fragile=True, tags=()),
    ToteItem("lantern", "Storm lantern", 0.5, 4.0, fragile=True, tags=()),
    ToteItem("oilcan", "Oil can", 0.9, 3.0, fragile=False, tags=("liquid",)),
    ToteItem("blanket", "Wool blanket", 1.4, 4.0, fragile=False, tags=("fabric",)),
    ToteItem("chisel", "Chisel", 0.4, 3.0, fragile=False, tags=("sharp",)),
    ToteItem("mirror", "Hand mirror", 0.7, 5.0, fragile=True, tags=()),
    ToteItem("screws", "Box of screws", 0.6, 2.0, fragile=False, tags=()),
    ToteItem("bucket", "Bucket", 1.0, 3.0, fragile=False, tags=()),
    ToteItem("radio", "Hand radio", 0.8, 6.0, fragile=True, tags=()),
)

BY_ID: dict[str, ToteItem] = {item.id: item for item in MASTER_CATALOG}


@dataclass(frozen=True)
class ToteResult:
    """Scored packing: value earned minus damage taken."""

    seed: int
    provider: str
    offered: tuple[str, ...]
    packing: tuple[str, ...]
    value: float
    overweight: float
    crush: float
    stain: float
    cut: float
    damage: float
    score: float
    tokens_used: int
    invalid_reason: str | None
    thinking_tokens: int = 0
    scarce: tuple[str, ...] = ()
    wildcards: tuple[str, ...] = ()
    badges: tuple[str, ...] = ()
    bonus: float = 0.0
    usage_anomaly: bool = False


def offered_catalog(seed: int) -> tuple[str, ...]:
    """Ten item ids for this seed, drawn deterministically."""
    rng = random.Random(seed)  # noqa: S311 -- seeded draw, not crypto.
    return tuple(item.id for item in rng.sample(list(MASTER_CATALOG), OFFER_COUNT))


def scarce_ids(seed: int, offered: tuple[str, ...]) -> tuple[str, ...]:
    """Two scarce ids for this seed, from its own deterministic stream."""
    rng = random.Random(f"scarce-{seed}")  # noqa: S311 -- seeded draw, not crypto.
    return tuple(rng.sample(list(offered), min(SCARCE_COUNT, len(offered))))


def wildcard_ids(packing: list[str], offered: tuple[str, ...]) -> tuple[str, ...]:
    """Validated packing ids that came from free slots, in pack order."""
    offered_set = set(offered)
    return tuple(item for item in packing if item not in offered_set)


def parse_packing(
    text: str, offered: tuple[str, ...]
) -> tuple[list[str] | None, str | None]:
    """Validate a packing list; return (packing, invalid_reason)."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None, "unparseable_json"
    if not isinstance(data, dict):
        return None, "not_an_object"
    reason = _packing_error(data.get("packing"), offered)
    if reason is not None:
        return None, reason
    packing = data["packing"]
    ids: list[str] = [entry for entry in packing if isinstance(entry, str)]
    return ids, None


def _packing_error(packing: object, offered: tuple[str, ...]) -> str | None:
    """Name the first packing-list defect, or None when the list is usable."""
    if not isinstance(packing, list) or not packing:
        return "empty_packing"
    if any(not isinstance(entry, str) for entry in packing):
        return "non_string_item"
    ids = [entry for entry in packing if isinstance(entry, str)]
    if len(set(ids)) != len(ids):
        return "duplicate_item"
    if any(item not in BY_ID for item in ids):
        return "unknown_item"
    wildcards = sum(1 for item in ids if item not in set(offered))
    if wildcards > FREE_SLOTS:
        return "too_many_wildcards"
    return None


def grade_packing(
    seed: int, packing: list[str], offered: tuple[str, ...]
) -> ToteResult:
    """Score value minus damage plus badge and scarcity bonuses."""
    items = [BY_ID[item_id] for item_id in packing]
    value = sum(item.value for item in items)
    total_weight = sum(item.weight for item in items)
    overweight = max(0.0, total_weight - CAPACITY_KG) * OVERWEIGHT_RATE
    crush = 0.0
    stain = 0.0
    cut = 0.0
    for position, item in enumerate(items):
        above = items[position + 1 :]
        below = items[:position]
        if item.fragile:
            crush += sum(other.weight for other in above) * CRUSH_RATE
        if "liquid" in item.tags and any("fabric" in other.tags for other in below):
            stain = STAIN_COST
        if "sharp" in item.tags and any(other.id == "rope" for other in below):
            cut = CUT_COST
    damage = overweight + crush + stain + cut
    scarce = scarce_ids(seed, offered)
    badges = _badges_for(items, total_weight, damage)
    bonus = round(len(badges) * BADGE_BONUS, 2)
    scarce_packed = sum(1 for item_id in packing if item_id in set(scarce))
    bonus = round(bonus + scarce_packed * SCARCE_BONUS, 2)
    return ToteResult(
        seed=seed,
        provider="",
        offered=offered,
        packing=tuple(packing),
        value=value,
        overweight=round(overweight, 2),
        crush=round(crush, 2),
        stain=stain,
        cut=cut,
        damage=round(damage, 2),
        score=max(0.0, round(value - damage + bonus, 2)),
        tokens_used=0,
        invalid_reason=None,
        scarce=scarce,
        wildcards=wildcard_ids(packing, offered),
        badges=badges,
        bonus=bonus,
    )


def _badges_for(
    items: list[ToteItem], total_weight: float, damage: float
) -> tuple[str, ...]:
    """Challenge badges earned by this packing, in award order."""
    earned: list[str] = []
    if total_weight < CAPACITY_KG:
        earned.append(BADGE_LIGHT_PACK)
    fragile_positions = [pos for pos, item in enumerate(items) if item.fragile]
    top_start = len(items) - FRAGILE_TOP_SLOTS
    if fragile_positions and all(pos >= top_start for pos in fragile_positions):
        earned.append(BADGE_FRAGILE_TOP)
    if damage == 0.0:
        earned.append(BADGE_SPOTLESS)
    return tuple(earned)


def run_tote(
    prompt: str, provider: ModelProvider, seed: int, config: MatchConfig | None = None
) -> ToteResult:
    """Play one tote match: one provider completion, validated and scored."""
    limits = config or MatchConfig()
    words = count_words(prompt)
    if words > limits.prompt_max_words:
        msg = f"prompt has {words} words, cap is {limits.prompt_max_words}"
        raise PromptTooLongError(msg)
    offered = offered_catalog(seed)
    scarce = scarce_ids(seed, offered)
    state = json.dumps(
        {
            "capacity_kg": CAPACITY_KG,
            "offered": list(offered),
            "scarce": list(scarce),
            "free_slots": FREE_SLOTS,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    system = f"{prompt}\n\n{TOTE_REPLY_SHAPE}"
    completion = provider.complete(system, state)
    reported = completion.game_tokens
    expected = estimate_tokens(system + state) + estimate_tokens(completion.text)
    anomaly = usage_anomaly(reported, expected)
    tokens_used = reported if reported > 0 else expected

    def failed(reason: str) -> ToteResult:
        """Zero-scored result with the failure reason attached."""
        return ToteResult(
            seed=seed,
            provider=provider.name,
            offered=offered,
            packing=(),
            value=0.0,
            overweight=0.0,
            crush=0.0,
            stain=0.0,
            cut=0.0,
            damage=0.0,
            score=0.0,
            tokens_used=tokens_used,
            invalid_reason=reason,
            thinking_tokens=completion.reasoning_tokens,
            scarce=scarce_ids(seed, offered),
            usage_anomaly=anomaly,
        )

    if tokens_used > limits.token_budget:
        return failed("token_budget_exceeded")
    packing, invalid_reason = parse_packing(completion.text, offered)
    if packing is None:
        return failed(invalid_reason or "unknown_packing_error")
    graded = grade_packing(seed, packing, offered)
    return ToteResult(
        seed=graded.seed,
        provider=provider.name,
        offered=offered,
        packing=graded.packing,
        value=graded.value,
        overweight=graded.overweight,
        crush=graded.crush,
        stain=graded.stain,
        cut=graded.cut,
        damage=graded.damage,
        score=graded.score,
        tokens_used=tokens_used,
        invalid_reason=None,
        thinking_tokens=completion.reasoning_tokens,
        scarce=graded.scarce,
        wildcards=graded.wildcards,
        badges=graded.badges,
        bonus=graded.bonus,
        usage_anomaly=anomaly,
    )
