"""Simulator tests: determinism, shock schedule, and seed secrecy."""

from __future__ import annotations

import json
import unittest

from aim_sim.simulator import ResilientCitySim
from tests.support import balanced_action


def _play(seed: int, turns: int = 12) -> ResilientCitySim:
    sim = ResilientCitySim(seed)
    for _ in range(turns):
        sim.step(balanced_action())
    return sim


class SimulatorTest(unittest.TestCase):
    """The sim is deterministic, scheduled, and hides the seed."""

    def test_same_seed_same_hashes(self) -> None:
        first = ResilientCitySim(7)
        second = ResilientCitySim(7)
        for _ in range(12):
            self.assertEqual(first.state_hash(), second.state_hash())
            first.step(balanced_action())
            second.step(balanced_action())
        self.assertEqual(first.spend_total, second.spend_total)
        self.assertEqual(first.lives_stabilized, second.lives_stabilized)

    def test_seeds_diverge(self) -> None:
        hashes = {_play(seed, turns=5).state_hash() for seed in range(1, 6)}
        self.assertGreater(len(hashes), 1)

    def test_flood_on_turn_five(self) -> None:
        sim = _play(3, turns=5)
        self.assertIsNotNone(sim.crisis)
        assert sim.crisis is not None
        self.assertEqual(sim.crisis.kind, "flood")
        self.assertGreater(sim.total_exposed, 0)

    def test_second_shock_on_turn_nine(self) -> None:
        sim = _play(3, turns=9)
        self.assertIsNotNone(sim.crisis)
        assert sim.crisis is not None
        self.assertIn(sim.crisis.kind, ("heatwave", "infra_failure"))

    def test_state_view_hides_seed(self) -> None:
        sim = ResilientCitySim(12345)
        dumped = json.dumps(sim.state_view(15000))
        self.assertNotIn("seed", dumped)
        self.assertNotIn("12345", dumped)

    def test_step_past_done_raises(self) -> None:
        sim = _play(1)
        self.assertTrue(sim.done)
        with self.assertRaises(ValueError):
            sim.step(balanced_action())

    def test_skipped_turn_spends_nothing(self) -> None:
        sim = ResilientCitySim(1)
        spend = sim.step(None)
        self.assertEqual(spend, 0)
        self.assertEqual(sim.skipped_turns, 1)
        self.assertEqual(sim.turn, 1)


if __name__ == "__main__":
    unittest.main()
