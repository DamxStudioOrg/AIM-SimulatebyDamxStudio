"""Scoring tests: hand-checked weights and cost dilution."""

from __future__ import annotations

import unittest

from aim_sim.models import AgentAction, TurnLog
from aim_sim.scoring import (
    BADGE_CLEAN_SHEET,
    BADGE_FULL_COFFERS,
    BADGE_GREEN_SHIFT,
    badges,
    efficiency,
    full_scores,
    impact,
    loss_reasons,
    strategy_fingerprint,
    subscores,
)
from aim_sim.simulator import BASE_QUARTERLY_INCOME, MAX_RESERVE_RATIO, ResilientCitySim
from tests.support import BALANCED_ALLOCATION, balanced_action


class ScoringTest(unittest.TestCase):
    """Weights match the contract; spend and tokens dilute efficiency."""

    def test_uniform_subscores_pass_through(self) -> None:
        sub = {
            "wellbeing": 50.0,
            "lives": 50.0,
            "infra": 50.0,
            "emissions": 50.0,
            "fiscal": 50.0,
        }
        self.assertEqual(impact(sub), 50.0)

    def test_weights_match_contract(self) -> None:
        sub = {
            "wellbeing": 100.0,
            "lives": 0.0,
            "infra": 0.0,
            "emissions": 0.0,
            "fiscal": 0.0,
        }
        self.assertEqual(impact(sub), 25.0)
        sub = {
            "wellbeing": 0.0,
            "lives": 100.0,
            "infra": 0.0,
            "emissions": 0.0,
            "fiscal": 0.0,
        }
        self.assertEqual(impact(sub), 30.0)

    def test_free_match_keeps_full_impact(self) -> None:
        self.assertEqual(efficiency(80.0, 0.0, 0), 80.0)

    def test_cost_dilutes_efficiency(self) -> None:
        lean = efficiency(80.0, 100_000.0, 3_000)
        heavy = efficiency(80.0, 500_000.0, 15_000)
        self.assertGreater(lean, heavy)
        self.assertAlmostEqual(heavy, 80.0 / 3.0, places=2)

    def test_full_scores_cover_both_boards(self) -> None:
        sim = ResilientCitySim(2)
        for _ in range(12):
            sim.step(balanced_action())
        scores = full_scores(sim, 5_000)
        for key in (
            "wellbeing",
            "lives",
            "infra",
            "emissions",
            "fiscal",
            "impact",
            "efficiency",
        ):
            self.assertIn(key, scores)
            self.assertGreaterEqual(scores[key], 0.0)
            self.assertLessEqual(scores[key], 100.0)

    def test_subscores_use_finished_state(self) -> None:
        sim = ResilientCitySim(2)
        for _ in range(12):
            sim.step(balanced_action())
        sub = subscores(sim)
        self.assertGreaterEqual(sub["lives"], 0.0)
        self.assertLessEqual(sub["lives"], 100.0)

    def test_fresh_sim_reports_clean_sheet(self) -> None:
        reasons = loss_reasons(ResilientCitySim(9), 0)
        self.assertEqual(len(reasons), 1)
        self.assertIn("clean sheet", reasons[0])

    def test_finished_match_explains_losses(self) -> None:
        sim = ResilientCitySim(4)
        for _ in range(12):
            sim.step(balanced_action())
        reasons = loss_reasons(sim, 16_000)
        self.assertTrue(any("lives lost" in r or "clean sheet" in r for r in reasons))
        self.assertTrue(any("tokens burned" in r for r in reasons))

    def test_idle_crisis_spend_is_named(self) -> None:
        sim = ResilientCitySim(11)
        sim.step(balanced_action())
        reasons = loss_reasons(sim, 0)
        self.assertTrue(any("no crisis to absorb it" in r for r in reasons))

    def test_overcap_reserves_are_named(self) -> None:
        sim = ResilientCitySim(11)
        sim.reserves = 300_000.0
        action = AgentAction.from_untrusted(
            {
                "allocation": {
                    "housing": 0.0,
                    "transit": 0.0,
                    "health": 0.0,
                    "green": 0.0,
                    "reserves": 100.0,
                    "rescue": 0.0,
                    "shelter": 0.0,
                    "repair": 0.0,
                },
                "policies": [],
                "note": "",
            }
        )
        sim.step(action)
        reasons = loss_reasons(sim, 0)
        self.assertTrue(any("above the $240,000 cap" in r for r in reasons))


class BadgeTest(unittest.TestCase):
    """Badges reward death-free, rich, and green finishes."""

    def test_fresh_city_earns_clean_sheet_only(self) -> None:
        sim = ResilientCitySim(seed=1)
        self.assertEqual(badges(sim), [BADGE_CLEAN_SHEET])

    def test_full_coffers_needs_capped_reserves(self) -> None:
        sim = ResilientCitySim(seed=1)
        sim.reserves = BASE_QUARTERLY_INCOME * MAX_RESERVE_RATIO
        earned = badges(sim)
        self.assertIn(BADGE_FULL_COFFERS, earned)
        sim.reserves -= 1.0
        self.assertNotIn(BADGE_FULL_COFFERS, badges(sim))

    def test_green_shift_needs_deep_emissions_cut(self) -> None:
        sim = ResilientCitySim(seed=1)
        sim.emissions_delta = -5.0
        self.assertIn(BADGE_GREEN_SHIFT, badges(sim))
        sim.emissions_delta = -4.9
        self.assertNotIn(BADGE_GREEN_SHIFT, badges(sim))

    def test_deaths_deny_clean_sheet(self) -> None:
        sim = ResilientCitySim(seed=1)
        sim.lives_lost_by_kind["flood"] = 3
        self.assertNotIn(BADGE_CLEAN_SHEET, badges(sim))


class FingerprintTest(unittest.TestCase):
    """Fingerprints profile mean allocations and policy use."""

    def test_balanced_match_profiles_balanced(self) -> None:
        action = balanced_action()
        turns = [
            TurnLog(
                turn=i + 1,
                state_hash="h",
                action=action,
                skip_reason=None,
                tokens_used=10,
                spend=1,
            )
            for i in range(12)
        ]
        profile = strategy_fingerprint(turns)
        self.assertEqual(profile["mean_allocation"], dict(BALANCED_ALLOCATION))
        self.assertEqual(profile["policies"], {})
        self.assertEqual(profile["played_turns"], 12)
        self.assertEqual(profile["skipped_turns"], 0)

    def test_skips_and_policies_counted(self) -> None:
        action = AgentAction.from_untrusted(
            {"allocation": dict(BALANCED_ALLOCATION), "policies": ["curfew"]}
        )
        played = TurnLog(1, "h", action, None, 10, 1)
        skipped = TurnLog(2, "h", None, "invalid_output", 0, 0)
        profile = strategy_fingerprint([played, skipped])
        self.assertEqual(profile["policies"], {"curfew": 1})
        self.assertEqual(profile["played_turns"], 1)
        self.assertEqual(profile["skipped_turns"], 1)


if __name__ == "__main__":
    unittest.main()
