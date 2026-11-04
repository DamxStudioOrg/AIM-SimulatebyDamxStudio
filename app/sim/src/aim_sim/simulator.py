"""Deterministic 12-turn city stewardship + crisis response simulator.

All randomness derives from the match seed via one `random.Random`
instance, consumed in a fixed order, so replays are exact.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from typing import Literal

from aim_sim.chaos import fourier_field
from aim_sim.models import (
    ALLOCATION_KEYS,
    DISTRICT_IDS,
    POLICY_TABLE,
    SHOCK_1_TURN,
    SHOCK_2_TURN,
    SIM_VERSION,
    TURNS,
    AgentAction,
)
from aim_sim.terraform import GeomorphologyState

BASE_QUARTERLY_INCOME = 120_000
BASE_POPULATION = 50_000
STARTING_RESERVES = 60_000
STARTING_APPROVAL = 60.0
STARTING_WELLBEING = 60.0
STARTING_HOUSING = 65.0
STARTING_TRANSIT = 2.0
STARTING_HEALTH = 400.0
STARTING_GREEN = 10.0
STARTING_INFRA = 90.0
MAX_TRANSIT_LEVEL = 5.0
MAX_RESERVE_RATIO = 2.0  # reserves beyond 2x income stop counting as useful
MEDICS_MULT = 1.5
SHELTERS_MULT = 2.0
MUTUAL_AID_MULT = 1.6
HEALTH_DIVISOR = 1200.0
RESCUE_DOLLARS_PER_LIFE = 220.0
SHELTER_DOLLARS_PER_PERSON = 260.0
REPAIR_DOLLARS_PER_POINT = 9000.0
BASE_DEATH_RATE = 0.10
SEVERITY_DEATH_STEP = 0.02
EVACUATE_DEATH_MULT = 0.55
CURFEW_DEATH_MULT = 0.9
RATION_DEATH_MULT = 0.7

Phase = Literal["stewardship", "shock", "response", "recovery"]


@dataclass
class District:
    """One city district with damage and displacement state."""

    code: str
    infra_pct: float = STARTING_INFRA
    displaced: int = 0
    at_risk: int = 0


@dataclass
class Crisis:
    """An active shock being resolved over several turns."""

    kind: str
    district: str
    severity: int  # 1-5
    turns_remaining: int


@dataclass
class DelayedEffect:
    """An investment whose payoff lands on a later turn."""

    due_turn: int
    kind: str
    amount: float


@dataclass
class ResilientCitySim:
    """Mutable match state. Create one per match, call `step` 12 times."""

    seed: int
    turn: int = 0
    reserves: float = float(STARTING_RESERVES)
    debt: float = 0.0
    approval: float = STARTING_APPROVAL
    housing_coverage: float = STARTING_HOUSING
    transit_level: float = STARTING_TRANSIT
    health_capacity: float = STARTING_HEALTH
    green_pct: float = STARTING_GREEN
    emissions_delta: float = 0.0  # negative means cut vs baseline
    wellbeing: float = STARTING_WELLBEING
    districts: dict[str, District] = field(default_factory=dict)
    crisis: Crisis | None = None
    delayed: list[DelayedEffect] = field(default_factory=list)
    spend_total: float = 0.0
    wasted_spend: float = 0.0
    wasted_idle: float = 0.0
    wasted_overcap: float = 0.0
    lives_stabilized: int = 0
    lives_lost_by_kind: dict[str, int] = field(default_factory=dict)
    total_exposed: int = 0
    skipped_turns: int = 0
    mutual_aid_turns: int = 0
    environment: GeomorphologyState | None = field(default=None, repr=False)
    chaos_level: float = 0.0
    _rng: random.Random = field(default_factory=random.Random, repr=False)
    _chaos: tuple[float, ...] = field(default_factory=tuple, repr=False)

    def __post_init__(self) -> None:
        """Seed the RNG and build districts exactly once."""
        self._rng = random.Random(self.seed)  # noqa: S311 -- seeded draw, not crypto.
        self.chaos_level = min(1.0, max(0.0, self.chaos_level))
        self._chaos = fourier_field(self.seed) if self.chaos_level > 0 else ()
        if not self.districts:
            self.districts = {code: District(code) for code in DISTRICT_IDS}
        if self.environment is None:
            self.environment = GeomorphologyState(self.seed, self.chaos_level)

    @property
    def land(self) -> GeomorphologyState:
        """The match's geomorphology state (built in `__post_init__`)."""
        if self.environment is None:  # pragma: no cover - post-init sets it
            msg = "environment not initialised"
            raise RuntimeError(msg)
        return self.environment

    @property
    def done(self) -> bool:
        """True once all turns have been played."""
        return self.turn >= TURNS

    @property
    def phase(self) -> Phase:
        """Current narrative phase from the turn number and crisis state."""
        if self.crisis is not None:
            return "shock" if self.turn in (SHOCK_1_TURN, SHOCK_2_TURN) else "response"
        if self.turn < SHOCK_1_TURN:
            return "stewardship"
        return "recovery"

    def state_view(self, tokens_remaining: int) -> dict[str, object]:
        """Agent-visible state. Never includes the seed."""
        return {
            "sim_version": SIM_VERSION,
            "turn": self.turn + 1,
            "phase": self.phase,
            "tokens_remaining": tokens_remaining,
            "budget": {
                "quarterly_income": self._quarterly_income(),
                "reserves": round(self.reserves),
                "debt": round(self.debt),
                "approval": round(self.approval, 1),
            },
            "city": {
                "population": BASE_POPULATION,
                "housing_coverage_pct": round(self.housing_coverage, 1),
                "transit_level": round(self.transit_level, 1),
                "health_capacity": round(self.health_capacity),
                "green_space_pct": round(self.green_pct, 1),
                "emissions_vs_baseline_pct": round(self.emissions_delta, 1),
                "wellbeing_index": round(self.wellbeing, 1),
                "districts": [
                    {
                        "id": district.code,
                        "infra_pct": round(district.infra_pct, 1),
                        "displaced": district.displaced,
                        "at_risk": district.at_risk,
                    }
                    for district in (self.districts[code] for code in DISTRICT_IDS)
                ],
            },
            "crisis": (
                None
                if self.crisis is None
                else {
                    "active": True,
                    "kind": self.crisis.kind,
                    "district": self.crisis.district,
                    "severity": self.crisis.severity,
                    "turns_remaining": self.crisis.turns_remaining,
                }
            ),
            "environment": {
                "sites": self.land.site_health(),
                "conditions": self.land.summary(),
                "features": self.land.feature_counts(),
                "stewardship_bias": round(self.land.stewardship_bias, 1),
                "restoration_weather": self.land.restoration_weather,
                "directives": self.land.directives(self.turn + 1),
            },
            "forecast": {
                "next_turn_shock_risk_pct": self._forecast_risk(),
                "note": "noisy by design",
            },
            "history": {
                "spend_total": round(self.spend_total),
                "lives_stabilized": self.lives_stabilized,
                "lives_lost": sum(self.lives_lost_by_kind.values()),
                "skipped_turns": self.skipped_turns,
            },
        }

    def state_hash(self) -> str:
        """Short content hash of the agent-visible state for replay checks."""
        canonical = json.dumps(
            self.state_view(0), sort_keys=True, separators=(",", ":")
        )
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]

    def step(self, action: AgentAction | None) -> int:
        """Advance one turn. Returns virtual dollars spent this turn.

        A `None` action is a skipped turn: no new spend, penalty counter up.
        """
        if self.done:
            msg = "match is already complete"
            raise ValueError(msg)
        self.turn += 1
        self._maybe_trigger_shock()
        self._apply_delayed()
        if action is None:
            self.skipped_turns += 1
            self._resolve_crisis(0.0, 0.0, 0.0, ())
            self._update_wellbeing()
            self.land.advance({}, turn=self.turn)
            return 0
        income = self._quarterly_income()
        spend = self._spend_allocation(action, income)
        self._apply_investment(action, income)
        self._resolve_crisis(
            action.allocation["rescue"] / 100.0 * income,
            action.allocation["shelter"] / 100.0 * income,
            action.allocation["repair"] / 100.0 * income,
            action.policies,
        )
        self._update_wellbeing()
        self.land.advance(dict(action.allocation), turn=self.turn)
        return spend

    def _quarterly_income(self) -> int:
        drift = 0.9 + self.wellbeing / 500.0
        return int(BASE_QUARTERLY_INCOME * drift)

    def _forecast_risk(self) -> int:
        base = 8
        if self.turn + 1 in (SHOCK_1_TURN, SHOCK_2_TURN):
            base = 55
        noise = self._rng.randint(-5, 5)
        return max(0, min(95, base + noise))

    def _maybe_trigger_shock(self) -> None:
        if self.turn == SHOCK_1_TURN:
            self._trigger("flood")
        elif self.turn == SHOCK_2_TURN:
            kind = self._rng.choice(["heatwave", "infra_failure"])
            self._trigger(kind)

    def _trigger(self, kind: str) -> None:
        district_id = self._rng.choice(DISTRICT_IDS)
        severity = self._rng.randint(2, 5)
        district = self.districts[district_id]
        # Preparedness absorbs the blow: housing and infra soften displacement.
        hardness = (self.housing_coverage / 100.0 + district.infra_pct / 100.0) / 2.0
        exposed = int(severity * 900 * (1.25 - hardness))
        if kind == "heatwave":
            exposed = int(exposed * (1.3 - self.green_pct / 50.0))
        exposed = max(100, exposed)
        if self._chaos:
            sample = self._chaos[self.turn % len(self._chaos)]
            exposed = max(100, int(exposed * (1.0 + self.chaos_level * 0.5 * sample)))
        district.at_risk += exposed
        district.displaced += exposed // 2
        district.infra_pct = max(10.0, district.infra_pct - severity * 9.0)
        self.total_exposed += exposed
        self.crisis = Crisis(kind, district_id, severity, turns_remaining=3)

    def _spend_allocation(self, action: AgentAction, income: int) -> int:
        policy_cost = sum(POLICY_TABLE[name].cost for name in action.policies)
        invest_share = sum(
            action.allocation[key] for key in ALLOCATION_KEYS if key != "reserves"
        )
        spend = int(invest_share / 100.0 * income) + policy_cost
        saved = int(action.allocation["reserves"] / 100.0 * income)
        self.reserves += saved
        shortfall = spend - income - saved
        if shortfall > 0 and self.reserves >= shortfall:
            self.reserves -= shortfall
        elif shortfall > 0:
            self.debt += shortfall - self.reserves
            self.reserves = 0.0
        # Hoarding past the cap and crisis buckets with no crisis both waste.
        cap = BASE_QUARTERLY_INCOME * MAX_RESERVE_RATIO
        if self.reserves > cap:
            overcap = self.reserves - cap
            self.wasted_spend += overcap
            self.wasted_overcap += overcap
            self.reserves = cap
        if self.crisis is None:
            idle = sum(action.allocation[k] for k in ("rescue", "shelter")) / 100.0
            idle_spend = idle * income
            self.wasted_spend += idle_spend
            self.wasted_idle += idle_spend
        self.spend_total += spend
        return spend

    def _apply_investment(self, action: AgentAction, income: int) -> None:
        alloc = action.allocation
        self.housing_coverage = min(
            100.0, self.housing_coverage + alloc["housing"] / 100.0 * 3.2
        )
        self.transit_level = min(
            MAX_TRANSIT_LEVEL, self.transit_level + alloc["transit"] / 100.0 * 0.35
        )
        self.health_capacity += alloc["health"] / 100.0 * income / 900.0
        self.green_pct = min(40.0, self.green_pct + alloc["green"] / 100.0 * 1.1)
        # Transit emissions payoff lands 3 turns later; approval dips now.
        self.delayed.append(
            DelayedEffect(
                due_turn=self.turn + 3,
                kind="emissions",
                amount=alloc["transit"] / 100.0 * 2.4,
            )
        )
        self.approval = max(0.0, self.approval - alloc["transit"] / 100.0 * 1.5)
        if "curfew" in action.policies:
            self.approval = max(0.0, self.approval - 2.0)
        if "request_mutual_aid" in action.policies:
            self.mutual_aid_turns = 2
        # Idle repair outside a crisis still maintains infra slightly.
        upkeep = alloc["repair"] / 100.0
        for district in self.districts.values():
            district.infra_pct = min(100.0, district.infra_pct + upkeep * 1.5)

    def _apply_delayed(self) -> None:
        remaining: list[DelayedEffect] = []
        for effect in self.delayed:
            if effect.due_turn > self.turn:
                remaining.append(effect)
                continue
            if effect.kind == "emissions":
                self.emissions_delta -= effect.amount
        self.delayed = remaining

    def _resolve_crisis(
        self, rescue: float, shelter: float, repair: float, policies: tuple[str, ...]
    ) -> None:
        crisis = self.crisis
        if crisis is None:
            return
        district = self.districts[crisis.district]
        self._apply_relief(district, rescue, shelter, repair, policies)
        self._apply_attrition(district, crisis, policies)
        crisis.turns_remaining -= 1
        if self.mutual_aid_turns > 0:
            self.mutual_aid_turns -= 1
        if crisis.turns_remaining <= 0:
            # Unresolved exposure converts to displacement, not icons on a map.
            district.displaced += district.at_risk
            district.at_risk = 0
            self.crisis = None

    def _apply_relief(
        self,
        district: District,
        rescue: float,
        shelter: float,
        repair: float,
        policies: tuple[str, ...],
    ) -> None:
        medic_mult = MEDICS_MULT if "emergency_hire_medics" in policies else 1.0
        health_mult = 1.0 + self.health_capacity / HEALTH_DIVISOR
        stabilized = int(rescue / RESCUE_DOLLARS_PER_LIFE * medic_mult * health_mult)
        stabilized = min(stabilized, district.at_risk)
        district.at_risk -= stabilized
        self.lives_stabilized += stabilized
        shelter_mult = SHELTERS_MULT if "open_shelters" in policies else 1.0
        rehoused = int(shelter / SHELTER_DOLLARS_PER_PERSON * shelter_mult)
        rehoused = min(rehoused, district.displaced)
        district.displaced -= rehoused
        repair_mult = MUTUAL_AID_MULT if self.mutual_aid_turns > 0 else 1.0
        district.infra_pct = min(
            100.0, district.infra_pct + repair / REPAIR_DOLLARS_PER_POINT * repair_mult
        )

    def _apply_attrition(
        self, district: District, crisis: Crisis, policies: tuple[str, ...]
    ) -> None:
        death_rate = BASE_DEATH_RATE + crisis.severity * SEVERITY_DEATH_STEP
        if "evacuate_district" in policies:
            death_rate *= EVACUATE_DEATH_MULT
        if "curfew" in policies:
            death_rate *= CURFEW_DEATH_MULT
        if crisis.kind == "heatwave" and "ration_water" in policies:
            death_rate *= RATION_DEATH_MULT
        deaths = int(district.at_risk * death_rate)
        district.at_risk -= deaths
        self.lives_lost_by_kind[crisis.kind] = (
            self.lives_lost_by_kind.get(crisis.kind, 0) + deaths
        )

    def _update_wellbeing(self) -> None:
        displaced = sum(d.displaced for d in self.districts.values())
        displacement_drag = min(25.0, displaced / 400.0)
        infra_mean = sum(d.infra_pct for d in self.districts.values()) / len(
            self.districts
        )
        target = (
            0.30 * self.housing_coverage
            + 0.20 * infra_mean
            + 0.20 * self.approval
            + 0.15 * min(100.0, self.health_capacity / 6.0)
            + 0.15 * min(100.0, self.green_pct * 4.0)
            - displacement_drag
        )
        # Wellbeing eases toward target: consequences lag decisions.
        self.wellbeing += (target - self.wellbeing) * 0.35
        self.wellbeing = max(0.0, min(100.0, self.wellbeing))
        self.approval += (self.wellbeing - self.approval) * 0.2
        self.approval = max(0.0, min(100.0, self.approval))
