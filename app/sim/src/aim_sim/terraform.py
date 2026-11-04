"""Geomorphology: seeded sites, feature placement, and live land state.

Every match seed grows the same three sites — Quarry, Aquifer, and
Vent Ridge — of 17 cells each. A cell's soil, slope, moisture,
fertility, heat, and erosion are fixed by the seed
(`GeomorphologyPlacer` seeds rocks, vents, and flora from those local
conditions). During the match `GeomorphologyState` evolves moisture,
erosion, and heat from weather, the bot's allocations, and a
persistent Stewardship bias built by ongoing Landkeeper investment
(green + shelter). A Place-restoration window on turns 6-8 applies one
signed weather — Rain, Seismic, or Heat — through that same shared
state; it alters local conditions and feature spawning, never the
ground mesh directly.

Each turn the state publishes directives: 3-5 variable tasks derived
from the worst cells, each with its own token limit. Bots are then
measured on prioritization — how well their allocation follows those
directives per token — which is reported, not folded into Impact.

Pure standard library and fully deterministic per seed.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from aim_sim.chaos import fourier_field

SITE_IDS: tuple[str, ...] = ("quarry", "aquifer", "vent")
CELLS_PER_SITE = 17
SOIL_TYPES: tuple[str, ...] = ("loam", "sand", "clay", "basalt")
FEATURE_TYPES: tuple[str, ...] = ("rock", "vent", "flora", "barren")
WEATHERS: tuple[str, ...] = ("rain", "seismic", "heat")

RESTORATION_TURNS: tuple[int, ...] = (6, 7, 8)
RESTORATION_REPLAY_SECONDS = 18
RESTORATION_MAGNITUDE = 9.0

DIRECTIVE_MIN = 3
DIRECTIVE_MAX = 5
TOKEN_LIMIT_MIN = 50
TOKEN_LIMIT_MAX = 250
TOKENS_PER_ALLOCATION_POINT = 12.0  # 1,200-token turn cap over 100 points

VENT_HEAT = 70.0
VENT_SLOPE = 45.0
ROCK_SLOPE = 68.0
ROCK_MOISTURE = 28.0
FLORA_FERTILITY = 55.0
FLORA_MOISTURE = 40.0
FLORA_MAX_SLOPE = 45.0

HOT_CELL = 72.0
ERODED_CELL = 62.0
DRY_CELL = 30.0
POOR_CELL = 34.0

STEWARDSHIP_BASELINE = 25.0
STEWARDSHIP_RATE = 0.08
STEWARDSHIP_MIN = -40.0
STEWARDSHIP_MAX = 40.0

INTERVENE_MOISTURE = 12.0
INTERVENE_HEAT_RELIEF = 14.0
INTERVENE_EROSION_CUT = 10.0

# Kind to the live-condition slot it shifts: 0 moisture, 2 heat, 3 erosion.
_INTERVENTION_SHIFT: dict[str, tuple[int, float]] = {
    "irrigate": (0, INTERVENE_MOISTURE),
    "vent_heat": (2, -INTERVENE_HEAT_RELIEF),
    "terrace": (3, -INTERVENE_EROSION_CUT),
}

# Per-site generation envelopes: (slope, moisture, heat, fertility).
_SITE_PROFILES: dict[str, tuple[tuple[float, float], ...]] = {
    "quarry": ((35.0, 85.0), (15.0, 50.0), (25.0, 55.0), (15.0, 45.0)),
    "aquifer": ((5.0, 40.0), (55.0, 95.0), (20.0, 50.0), (35.0, 75.0)),
    "vent": ((20.0, 70.0), (10.0, 45.0), (50.0, 95.0), (10.0, 40.0)),
}
_SITE_SOILS: dict[str, tuple[str, ...]] = {
    "quarry": ("basalt", "clay"),
    "aquifer": ("loam", "sand"),
    "vent": ("basalt", "sand"),
}
# Signed per-turn weather effects on (moisture, erosion, heat).
_WEATHER_EFFECTS: dict[str, tuple[float, float, float]] = {
    "rain": (RESTORATION_MAGNITUDE, 3.0, 0.0),
    "seismic": (0.0, 8.0, 2.0),
    "heat": (-5.0, 0.0, RESTORATION_MAGNITUDE),
}


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


@dataclass(frozen=True)
class Cell:
    """One seeded land cell: the placer's input and the report shape."""

    site: str
    index: int
    soil: str
    slope: float
    moisture: float
    fertility: float
    heat: float
    erosion: float

    def as_dict(self) -> dict[str, object]:
        """JSON-ready cell with its currently placed feature."""
        return {
            "site": self.site,
            "index": self.index,
            "soil": self.soil,
            "slope": round(self.slope, 1),
            "moisture": round(self.moisture, 1),
            "fertility": round(self.fertility, 1),
            "heat": round(self.heat, 1),
            "erosion": round(self.erosion, 1),
            "feature": place_feature(self),
        }


def place_feature(cell: Cell) -> str:
    """GeomorphologyPlacer: feature from local conditions only."""
    if cell.heat >= VENT_HEAT and cell.slope >= VENT_SLOPE:
        return "vent"
    if cell.slope >= ROCK_SLOPE or cell.moisture <= ROCK_MOISTURE:
        return "rock"
    if (
        cell.fertility >= FLORA_FERTILITY
        and cell.moisture >= FLORA_MOISTURE
        and cell.slope < FLORA_MAX_SLOPE
    ):
        return "flora"
    return "barren"


def generate_sites(seed: int) -> dict[str, list[Cell]]:
    """The seeded 3x17 landscape for one match seed."""
    rng = random.Random(f"aim-geomorphology-{seed}")  # noqa: S311 -- seeded.
    sites: dict[str, list[Cell]] = {}
    for site in SITE_IDS:
        (slope_r, moisture_r, heat_r, fertility_r) = _SITE_PROFILES[site]
        cells: list[Cell] = []
        for index in range(CELLS_PER_SITE):
            slope = rng.uniform(*slope_r)
            cells.append(
                Cell(
                    site=site,
                    index=index,
                    soil=rng.choice(_SITE_SOILS[site]),
                    slope=round(slope, 1),
                    moisture=round(rng.uniform(*moisture_r), 1),
                    fertility=round(rng.uniform(*fertility_r), 1),
                    heat=round(rng.uniform(*heat_r), 1),
                    erosion=round(_clamp(slope * 0.5 + rng.uniform(0.0, 20.0)), 1),
                )
            )
        sites[site] = cells
    return sites


def restoration_for_seed(seed: int) -> dict[str, object]:
    """The Place-restoration plan: one signed weather over turns 6-8."""
    rng = random.Random(f"aim-restoration-{seed}")  # noqa: S311 -- seeded.
    return {
        "weather": rng.choice(WEATHERS),
        "turns": list(RESTORATION_TURNS),
        "magnitude": RESTORATION_MAGNITUDE,
        "replay_seconds": RESTORATION_REPLAY_SECONDS,
    }


def _cell_health(moisture: float, heat: float, erosion: float) -> float:
    penalty = (
        max(0.0, erosion - 60.0) * 0.8
        + max(0.0, heat - 75.0) * 0.8
        + max(0.0, 25.0 - moisture) * 0.5
    )
    return _clamp(100.0 - penalty)


class GeomorphologyState:
    """Live land state: shared by spawners, ground visuals, and scoring.

    Cells start at their seeded conditions and evolve each turn from
    weather, the bot's allocation, and the Stewardship bias. The bias
    is persistent within the match: Landkeeper investment (green +
    shelter) builds it, neglect lets it decay only slowly.
    """

    def __init__(self, seed: int, chaos_level: float = 0.0) -> None:
        """Build live conditions from the seeded landscape.

        A chaos level above 0 perturbs moisture, fertility, and heat
        with the seeded Fourier field; level 0 leaves every cell at its
        generated value exactly.
        """
        self.seed = seed
        self.chaos_level = min(1.0, max(0.0, chaos_level))
        seeded = generate_sites(seed)
        # Mutable live conditions per cell: [moisture, fertility, heat, erosion].
        self._live: dict[str, list[list[float]]] = {
            site: [[c.moisture, c.fertility, c.heat, c.erosion] for c in cells]
            for site, cells in seeded.items()
        }
        if self.chaos_level > 0:
            self._apply_chaos()
        self._base: dict[str, list[Cell]] = seeded
        self.stewardship_bias = 0.0
        self.restoration_weather: str | None = None
        self.trace: list[dict[str, object]] = []
        self._last_intervention: str | None = None
        self._judged: list[tuple[list[dict[str, object]], dict[str, float]]] = []

    def _apply_chaos(self) -> None:
        """Perturb live moisture, fertility, and heat with Fourier noise.

        Each channel samples the field at a different offset so the
        three do not move in lockstep; erosion is untouched. Values stay
        clamped to 0..100 at the same 1-decimal precision as generation.
        """
        field = fourier_field(self.seed)
        span = len(field)
        for order, site in enumerate(SITE_IDS):
            for index, live in enumerate(self._live[site]):
                base = order * CELLS_PER_SITE + index
                live[0] = self._jitter(live[0], field[base % span], 8.0)
                live[1] = self._jitter(live[1], field[(base + 21) % span], 8.0)
                live[2] = self._jitter(live[2], field[(base + 43) % span], 6.0)

    def _jitter(self, value: float, sample: float, amplitude: float) -> float:
        """Scale one live condition by a field sample, clamped to 0..100."""
        jittered = value + self.chaos_level * amplitude * sample
        return min(100.0, max(0.0, round(jittered, 1)))

    # -- views ---------------------------------------------------------

    def _cells(self) -> list[Cell]:
        cells: list[Cell] = []
        for site in SITE_IDS:
            for base, live in zip(self._base[site], self._live[site], strict=True):
                cells.append(
                    Cell(
                        site=site,
                        index=base.index,
                        soil=base.soil,
                        slope=base.slope,
                        moisture=live[0],
                        fertility=live[1],
                        heat=live[2],
                        erosion=live[3],
                    )
                )
        return cells

    def summary(self) -> dict[str, float]:
        """Mean live conditions across every cell."""
        cells = self._cells()
        count = len(cells)
        return {
            "moisture": round(sum(c.moisture for c in cells) / count, 2),
            "fertility": round(sum(c.fertility for c in cells) / count, 2),
            "heat": round(sum(c.heat for c in cells) / count, 2),
            "erosion": round(sum(c.erosion for c in cells) / count, 2),
        }

    def site_health(self) -> dict[str, float]:
        """Per-site health from live conditions."""
        health: dict[str, float] = {}
        for site in SITE_IDS:
            cells = [c for c in self._cells() if c.site == site]
            health[site] = round(
                sum(_cell_health(c.moisture, c.heat, c.erosion) for c in cells)
                / len(cells),
                2,
            )
        return health

    def feature_counts(self) -> dict[str, int]:
        """Features the placer would spawn on live conditions."""
        counts: dict[str, int] = dict.fromkeys(FEATURE_TYPES, 0)
        for cell in self._cells():
            counts[place_feature(cell)] += 1
        return counts

    def directives(self, turn: int) -> list[dict[str, object]]:
        """Variable tasks from the worst live cells, worst first.

        Each directive names the allocation key that answers it and
        carries its own token limit scaled by severity, so a bot must
        judge which tasks deserve its capped tokens.
        """
        found: list[tuple[float, str, int, str]] = []
        for cell in self._cells():
            if cell.heat >= HOT_CELL:
                found.append((cell.heat, cell.site, cell.index, "rescue"))
            if cell.erosion >= ERODED_CELL:
                found.append((cell.erosion, cell.site, cell.index, "repair"))
            if cell.moisture <= DRY_CELL:
                found.append((100.0 - cell.moisture, cell.site, cell.index, "green"))
            if cell.fertility <= POOR_CELL:
                found.append((100.0 - cell.fertility, cell.site, cell.index, "green"))
        found.sort(key=lambda item: (-item[0], item[1], item[2]))
        tasks: list[dict[str, object]] = []
        for severity, site, index, need in found[:DIRECTIVE_MAX]:
            tasks.append(
                {
                    "id": f"t{turn}-{site}-{index}-{need}",
                    "site": site,
                    "cell": index,
                    "need": need,
                    "priority": round(severity),
                    "token_limit": int(
                        max(
                            TOKEN_LIMIT_MIN,
                            min(TOKEN_LIMIT_MAX, 50 + round(severity * 2)),
                        )
                    ),
                }
            )
        return tasks

    # -- evolution -----------------------------------------------------

    def intervene(self, kind: str) -> None:
        """Apply one steward intervention to every live cell, clamped.

        Raises:
            ValueError: If the kind is unknown.

        """
        shift = _INTERVENTION_SHIFT.get(kind)
        if shift is None:
            msg = f"unknown intervention: {kind!r}"
            raise ValueError(msg)
        slot, delta = shift
        for site in SITE_IDS:
            for live in self._live[site]:
                live[slot] = _clamp(live[slot] + delta)
        self._last_intervention = kind

    def advance(self, allocation: dict[str, float], turn: int) -> None:
        """Evolve every cell one turn through the shared state."""
        judged = self.directives(turn)
        self._judged.append((judged, dict(allocation)))

        restoration = (
            restoration_for_seed(self.seed)["weather"]
            if turn in RESTORATION_TURNS
            else None
        )
        if restoration is not None:
            self.restoration_weather = str(restoration)
        d_moisture, d_erosion, d_heat = (
            _WEATHER_EFFECTS[str(restoration)]
            if restoration is not None
            else (0.0, 0.0, 0.0)
        )

        green = allocation.get("green", 0.0)
        shelter = allocation.get("shelter", 0.0)
        repair = allocation.get("repair", 0.0)
        rescue = allocation.get("rescue", 0.0)
        self.stewardship_bias = max(
            STEWARDSHIP_MIN,
            min(
                STEWARDSHIP_MAX,
                self.stewardship_bias
                + (green + shelter - STEWARDSHIP_BASELINE) * STEWARDSHIP_RATE,
            ),
        )
        bias = self.stewardship_bias

        for site in SITE_IDS:
            for base, live in zip(self._base[site], self._live[site], strict=True):
                live[0] = _clamp(
                    live[0] + d_moisture + green * 0.015 + bias * 0.02 - 0.3
                )
                live[1] = _clamp(live[1] + green * 0.05 + bias * 0.01)
                live[2] = _clamp(
                    live[2] + d_heat - rescue * 0.03 + (base.heat - live[2]) * 0.04
                )
                live[3] = _clamp(
                    live[3] + d_erosion - repair * 0.06 + base.slope * 0.006
                )

        means = self.summary()
        self.trace.append(
            {
                "turn": turn,
                "restoration": restoration,
                "intervention": self._last_intervention,
                **means,
                "health": self.site_health(),
                "features": self.feature_counts(),
                "stewardship_bias": round(bias, 2),
            }
        )
        self._last_intervention = None

    # -- judgement -----------------------------------------------------

    def prioritization_score(self) -> float:
        """0-100: allocation follow-through on directives per token."""
        earned = 0.0
        possible = 0.0
        for directives, allocation in self._judged:
            for directive in directives:
                priority = float(directive["priority"])  # type: ignore[arg-type]
                needed = (
                    float(directive["token_limit"])  # type: ignore[arg-type]
                    / TOKENS_PER_ALLOCATION_POINT
                )
                spent = allocation.get(str(directive["need"]), 0.0)
                earned += priority * min(spent / needed, 1.0)
                possible += priority
        if possible == 0.0:
            return 100.0
        return round(100.0 * earned / possible, 2)

    def snapshot(self) -> dict[str, object]:
        """The finished match's environment report."""
        return {
            "sites": {
                site: [cell.as_dict() for cell in cells]
                for site, cells in (
                    (site, [c for c in self._cells() if c.site == site])
                    for site in SITE_IDS
                )
            },
            "site_health": self.site_health(),
            "summary": self.summary(),
            "features": self.feature_counts(),
            "stewardship_bias": round(self.stewardship_bias, 2),
            "restoration": restoration_for_seed(self.seed),
            "prioritization": self.prioritization_score(),
            "trace": self.trace,
        }
