"""Data model, constants, and validation for Resilient City Steward.

Pure standard library: the simulator core must run anywhere without
third-party installs. See TURN_CONTRACT.md for the normative rules.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

SIM_VERSION = "0.1.0"
TURNS = 12
SHOCK_1_TURN = 5
SHOCK_2_TURN = 9
PROMPT_MAX_WORDS = 250
TOKEN_BUDGET = 15_000
TURN_TOKEN_CAP = 1_200
NOTE_MAX_CHARS = 280
MAX_POLICIES_PER_TURN = 2
ALLOCATION_TOLERANCE = 0.01
EXPECTED_ALLOCATION_SUM = 100.0

ALLOCATION_KEYS: tuple[str, ...] = (
    "housing",
    "transit",
    "health",
    "green",
    "reserves",
    "rescue",
    "shelter",
    "repair",
)

DISTRICT_IDS: tuple[str, ...] = ("north", "east", "south", "west")

ALLOWED_POLICIES: frozenset[str] = frozenset(
    {
        "evacuate_district",
        "open_shelters",
        "ration_water",
        "emergency_hire_medics",
        "curfew",
        "request_mutual_aid",
    }
)


@dataclass(frozen=True)
class PolicySpec:
    """Fixed virtual cost and effect description for one policy."""

    name: str
    cost: int
    description: str


POLICY_TABLE: dict[str, PolicySpec] = {
    spec.name: spec
    for spec in (
        PolicySpec(
            "evacuate_district",
            25_000,
            "Move at-risk residents out; cuts shock deaths.",
        ),
        PolicySpec("open_shelters", 12_000, "Shelter capacity doubles this turn."),
        PolicySpec("ration_water", 2_000, "Cuts infra strain during heatwave."),
        PolicySpec(
            "emergency_hire_medics",
            18_000,
            "Rescue stabilizes 50% more lives this turn.",
        ),
        PolicySpec("curfew", 1_000, "Small approval cost, fewer crisis deaths."),
        PolicySpec("request_mutual_aid", 5_000, "Extra repair throughput next turn."),
    )
}


class InvalidActionError(ValueError):
    """Raised when untrusted model output violates the turn contract."""


@dataclass(frozen=True)
class AgentAction:
    """One validated turn output. Allocations sum to 100."""

    allocation: dict[str, float]
    policies: tuple[str, ...] = ()
    note: str = ""

    @classmethod
    def from_untrusted(cls, data: object) -> AgentAction:
        """Validate raw decoded JSON against the contract.

        Raises:
            InvalidActionError: If any contract rule is violated.

        """
        if not isinstance(data, Mapping):
            msg = "action must be a JSON object"
            raise InvalidActionError(msg)
        allocation = _validate_allocation(data.get("allocation"))
        policies = _validate_policies(data.get("policies", []))
        note = _validate_note(data.get("note", ""))
        return cls(allocation=allocation, policies=policies, note=note)


def _validate_allocation(data: object) -> dict[str, float]:
    if not isinstance(data, Mapping):
        msg = "allocation must be an object with 8 numeric keys"
        raise InvalidActionError(msg)
    keys = set(data.keys())
    if keys != set(ALLOCATION_KEYS):
        msg = f"allocation keys must be exactly {sorted(ALLOCATION_KEYS)}"
        raise InvalidActionError(msg)
    clean: dict[str, float] = {}
    for key in ALLOCATION_KEYS:
        value = data[key]
        if isinstance(value, bool) or not isinstance(value, int | float):
            msg = f"allocation[{key}] must be a number"
            raise InvalidActionError(msg)
        amount = float(value)
        if not math.isfinite(amount) or amount < 0:
            msg = f"allocation[{key}] must be finite and >= 0"
            raise InvalidActionError(msg)
        clean[key] = amount
    total = sum(clean.values())
    if abs(total - EXPECTED_ALLOCATION_SUM) > ALLOCATION_TOLERANCE:
        msg = f"allocation must sum to 100, got {total}"
        raise InvalidActionError(msg)
    return clean


def _validate_policies(data: object) -> tuple[str, ...]:
    if not isinstance(data, Sequence) or isinstance(data, str | bytes):
        msg = "policies must be an array of 0-2 policy names"
        raise InvalidActionError(msg)
    names = list(data)
    if len(names) > MAX_POLICIES_PER_TURN:
        msg = f"at most {MAX_POLICIES_PER_TURN} policies per turn"
        raise InvalidActionError(msg)
    for name in names:
        if not isinstance(name, str) or name not in ALLOWED_POLICIES:
            msg = f"unknown policy: {name!r}"
            raise InvalidActionError(msg)
    if len(set(names)) != len(names):
        msg = "policies must not repeat within a turn"
        raise InvalidActionError(msg)
    return tuple(names)


def _validate_note(data: object) -> str:
    if not isinstance(data, str):
        msg = "note must be a string"
        raise InvalidActionError(msg)
    if len(data) > NOTE_MAX_CHARS:
        msg = f"note must be <= {NOTE_MAX_CHARS} chars"
        raise InvalidActionError(msg)
    return data


INTERVENTION_KINDS: tuple[str, ...] = ("irrigate", "vent_heat", "terrace")
MAX_INTERVENTIONS_PER_MATCH = 3


@dataclass(frozen=True)
class Intervention:
    """One validated field-plan entry: a steward nudge on a turn."""

    turn: int
    kind: str

    @classmethod
    def from_untrusted(cls, data: object) -> Intervention:
        """Validate a raw field-plan entry against the match contract.

        Raises:
            InvalidActionError: If the turn or kind is invalid.

        """
        if not isinstance(data, Mapping):
            msg = "intervention must be a JSON object"
            raise InvalidActionError(msg)
        turn = data.get("turn")
        if isinstance(turn, bool) or not isinstance(turn, int):
            msg = "intervention turn must be an integer"
            raise InvalidActionError(msg)
        if turn < 1 or turn > TURNS:
            msg = f"intervention turn must be 1-{TURNS}, got {turn}"
            raise InvalidActionError(msg)
        kind = data.get("kind")
        if not isinstance(kind, str) or kind not in INTERVENTION_KINDS:
            msg = f"unknown intervention: {kind!r}"
            raise InvalidActionError(msg)
        return cls(turn=turn, kind=kind)


def validate_interventions(data: object) -> tuple[Intervention, ...]:
    """Validate a raw field plan: at most 3 entries, one per turn.

    Raises:
        InvalidActionError: If the plan shape breaks the contract.

    """
    if not isinstance(data, Sequence) or isinstance(data, str | bytes):
        msg = "interventions must be an array of field-plan entries"
        raise InvalidActionError(msg)
    entries = [Intervention.from_untrusted(item) for item in data]
    if len(entries) > MAX_INTERVENTIONS_PER_MATCH:
        msg = f"at most {MAX_INTERVENTIONS_PER_MATCH} interventions per match"
        raise InvalidActionError(msg)
    turns = [entry.turn for entry in entries]
    if len(set(turns)) != len(turns):
        msg = "interventions must not share a turn"
        raise InvalidActionError(msg)
    return tuple(entries)


@dataclass(frozen=True)
class MatchConfig:
    """Tunable match limits. Defaults are the rated-ladder values."""

    token_budget: int = TOKEN_BUDGET
    prompt_max_words: int = PROMPT_MAX_WORDS
    turn_token_cap: int = TURN_TOKEN_CAP
    turns: int = TURNS


@dataclass(frozen=True)
class ProviderCompletion:
    """One model call result with authoritative token usage."""

    text: str
    prompt_tokens: int
    completion_tokens: int
    reasoning_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        """Total tokens consumed by this call."""
        return self.prompt_tokens + self.completion_tokens

    @property
    def game_tokens(self) -> int:
        """Tokens billed to gameplay: prompt + answer, thinking excluded.

        Reasoning traces ride inside completion_tokens on servers that
        report them; the match budget, the per-turn cap, and recorded
        usage bill only what the turn said out loud.
        """
        answer = max(0, self.completion_tokens - self.reasoning_tokens)
        return self.prompt_tokens + answer


@dataclass(frozen=True)
class TurnLog:
    """Replay record for one turn."""

    turn: int
    state_hash: str
    action: AgentAction | None
    skip_reason: str | None
    tokens_used: int
    spend: int
    usage_anomaly: bool = False
    intervention: str | None = None
    impact: float = 0.0
    efficiency: float = 0.0
    thinking_tokens: int = 0


@dataclass
class MatchResult:
    """Full scored match with replay logs."""

    sim_version: str
    seed: int
    prompt_words: int
    provider: str
    turns: list[TurnLog] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)
    totals: dict[str, float] = field(default_factory=dict)
    loss_reasons: list[str] = field(default_factory=list)
    badges: list[str] = field(default_factory=list)
    strategy: dict[str, object] = field(default_factory=dict)
    environment: dict[str, object] = field(default_factory=dict)
    chaos_level: float = 0.0

    @property
    def tokens_used(self) -> int:
        """Total tokens consumed across all turns."""
        return sum(log.tokens_used for log in self.turns)

    @property
    def thinking_tokens(self) -> int:
        """Total thinking-trace tokens measured across all turns."""
        return sum(log.thinking_tokens for log in self.turns)
