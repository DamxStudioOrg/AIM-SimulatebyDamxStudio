"""Fourier chaos tests: deterministic field, level-0 identity, perturbation."""

from __future__ import annotations

import unittest
from typing import TYPE_CHECKING

from aim_sim.chaos import CHAOS_FIELD_LEN, CHAOS_MODES, fourier_field
from aim_sim.runner import MatchRunner, RunOptions, ScriptedProvider
from aim_sim.simulator import ResilientCitySim
from aim_sim.terraform import SITE_IDS, GeomorphologyState
from tests.support import balanced_action, balanced_json

if TYPE_CHECKING:
    from aim_sim.models import MatchResult

PROMPT = "Hold reserves and fund clinics early."
SEEDS = (1, 3, 7, 42)


def _live_values(state: GeomorphologyState) -> list[tuple[float, float, float]]:
    """Live moisture/fertility/heat per cell, in site order, via snapshot."""
    sites = state.snapshot()["sites"]
    assert isinstance(sites, dict)
    values: list[tuple[float, float, float]] = []
    for site in SITE_IDS:
        cells = sites[site]
        assert isinstance(cells, list)
        for cell in cells:
            assert isinstance(cell, dict)
            moisture = cell["moisture"]
            fertility = cell["fertility"]
            heat = cell["heat"]
            assert isinstance(moisture, int | float)
            assert isinstance(fertility, int | float)
            assert isinstance(heat, int | float)
            values.append((float(moisture), float(fertility), float(heat)))
    return values


def _run(seed: int, chaos_level: float) -> MatchResult:
    """One full scripted match at the given chaos level."""
    runner = MatchRunner()
    return runner.run(
        PROMPT,
        ScriptedProvider([balanced_json()]),
        seed,
        RunOptions(chaos_level=chaos_level),
    )


class FourierFieldTest(unittest.TestCase):
    """The field is deterministic, bounded, and seed-sensitive."""

    def test_deterministic_per_seed(self) -> None:
        for seed in SEEDS:
            self.assertEqual(fourier_field(seed), fourier_field(seed))

    def test_bounded_in_unit_interval(self) -> None:
        for seed in range(1, 26):
            for sample in fourier_field(seed):
                self.assertLessEqual(abs(sample), 1.0)

    def test_distinct_seeds_differ(self) -> None:
        fields = {fourier_field(seed) for seed in SEEDS}
        self.assertEqual(len(fields), len(SEEDS))

    def test_shape_defaults(self) -> None:
        field = fourier_field(7)
        self.assertEqual(len(field), CHAOS_FIELD_LEN)
        self.assertEqual(len(fourier_field(7, length=16, modes=3)), 16)
        self.assertGreater(CHAOS_MODES, 1)


class ChaosIdentityTest(unittest.TestCase):
    """Level 0 replays legacy terrain, shocks, and matches exactly."""

    def test_terrain_untouched_at_level_zero(self) -> None:
        for seed in SEEDS:
            legacy = _live_values(GeomorphologyState(seed))
            explicit = _live_values(GeomorphologyState(seed, chaos_level=0.0))
            self.assertEqual(legacy, explicit)

    def test_match_scores_untouched_at_level_zero(self) -> None:
        for seed in SEEDS:
            legacy = _run(seed, 0.0)
            explicit = MatchRunner().run(
                PROMPT, ScriptedProvider([balanced_json()]), seed, RunOptions()
            )
            self.assertEqual(legacy.scores, explicit.scores)
            self.assertEqual(legacy.totals, explicit.totals)
            self.assertEqual(legacy.environment, explicit.environment)

    def test_runner_clamps_level_into_unit_interval(self) -> None:
        over = _run(3, 9.0)
        under = _run(3, -4.0)
        self.assertEqual(over.chaos_level, 1.0)
        self.assertEqual(under.chaos_level, 0.0)
        self.assertEqual(under.scores, _run(3, 0.0).scores)


class ChaosPerturbationTest(unittest.TestCase):
    """Levels above 0 perturb terrain and shocks, staying in bounds."""

    def test_terrain_differs_and_stays_in_bounds(self) -> None:
        for seed in SEEDS:
            calm = _live_values(GeomorphologyState(seed))
            wild = _live_values(GeomorphologyState(seed, chaos_level=1.0))
            self.assertNotEqual(calm, wild)
            for cell in wild:
                for value in cell[:3]:
                    self.assertGreaterEqual(value, 0.0)
                    self.assertLessEqual(value, 100.0)

    def test_shock_exposure_differs_for_some_seed(self) -> None:
        def exposed(seed: int, level: float) -> int:
            sim = ResilientCitySim(seed, chaos_level=level)
            for _ in range(5):
                sim.step(balanced_action())
            return sim.total_exposed

        self.assertTrue(
            any(exposed(seed, 1.0) != exposed(seed, 0.0) for seed in range(1, 11))
        )

    def test_match_environment_differs_at_full_chaos(self) -> None:
        calm = _run(3, 0.0)
        wild = _run(3, 1.0)
        self.assertNotEqual(calm.environment, wild.environment)
        self.assertEqual(wild.chaos_level, 1.0)
