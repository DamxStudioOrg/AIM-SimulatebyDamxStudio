"""Tote-packing tests. Same unittest style as the other sim suits."""

from __future__ import annotations

import json
import unittest

from aim_sim.models import MatchConfig, ProviderCompletion
from aim_sim.runner import MockProvider, ScriptedProvider
from aim_sim.tote import (
    BADGE_BONUS,
    BADGE_FRAGILE_TOP,
    BADGE_LIGHT_PACK,
    BADGE_SPOTLESS,
    CAPACITY_KG,
    MASTER_CATALOG,
    SCARCE_BONUS,
    TOTE_REPLY_SHAPE,
    grade_packing,
    offered_catalog,
    parse_packing,
    run_tote,
    scarce_ids,
)


def pack(ids: list[str]) -> str:
    """One packing submission as raw model-output JSON."""
    return json.dumps({"packing": ids})


class CatalogTest(unittest.TestCase):
    """Seeded catalogs are deterministic and well-formed."""

    def test_same_seed_same_offer(self) -> None:
        self.assertEqual(offered_catalog(4), offered_catalog(4))

    def test_offer_has_ten_unique_known_ids(self) -> None:
        from aim_sim.tote import BY_ID

        offer = offered_catalog(4)
        self.assertEqual(len(offer), 10)
        self.assertEqual(len(set(offer)), 10)
        for item_id in offer:
            self.assertIn(item_id, BY_ID)

    def test_catalog_holds_twenty_four_unique_items(self) -> None:
        ids = [item.id for item in MASTER_CATALOG]
        self.assertEqual(len(ids), 24)
        self.assertEqual(len(set(ids)), 24)

    def test_scarce_is_two_deterministic_offered_ids(self) -> None:
        offer = offered_catalog(4)
        scarce = scarce_ids(4, offer)
        self.assertEqual(scarce, scarce_ids(4, offer))
        self.assertEqual(len(scarce), 2)
        for item_id in scarce:
            self.assertIn(item_id, offer)


class ParseTest(unittest.TestCase):
    """Invalid packing fails loudly with a reason, never an exception."""

    def test_rejects_garbage(self) -> None:
        offer = offered_catalog(4)
        for text in ["nope", "[]", "{}", json.dumps({"packing": []})]:
            _, reason = parse_packing(text, offer)
            self.assertIsNotNone(reason)

    def test_rejects_duplicates_and_strangers(self) -> None:
        offer = offered_catalog(4)
        first = offer[0]
        _, dup = parse_packing(pack([first, first]), offer)
        self.assertEqual(dup, "duplicate_item")
        _, stranger = parse_packing(pack(["saw", "nope"]), offer)
        self.assertIn(stranger, ("unknown_item",))

    def test_accepts_offered_ids(self) -> None:
        offer = offered_catalog(4)
        packing, reason = parse_packing(pack(list(offer[:3])), offer)
        self.assertIsNone(reason)
        self.assertEqual(packing, list(offer[:3]))


class DamageTest(unittest.TestCase):
    """Each damage rule fires on its own trigger."""

    def test_overweight_strains_past_capacity(self) -> None:
        graded = grade_packing(1, ["lumber", "paint", "drill", "saw", "hammer"], ())
        total = 3.0 + 2.5 + 1.8 + 1.5 + 1.2
        self.assertAlmostEqual(
            graded.overweight, round(max(0.0, total - CAPACITY_KG) * 2.0, 2)
        )

    def test_crush_counts_mass_above_fragile(self) -> None:
        graded = grade_packing(1, ["eggs", "hammer", "wrench"], ())
        self.assertAlmostEqual(graded.crush, round((1.2 + 0.8) * 0.4, 2))

    def test_liquid_over_fabric_stains(self) -> None:
        stained = grade_packing(1, ["tarp", "paint"], ())
        self.assertEqual(stained.stain, 3.0)
        clean = grade_packing(1, ["paint", "tarp"], ())
        self.assertEqual(clean.stain, 0.0)

    def test_sharp_over_rope_cuts(self) -> None:
        cut = grade_packing(1, ["rope", "saw"], ())
        self.assertEqual(cut.cut, 2.0)
        clean = grade_packing(1, ["saw", "rope"], ())
        self.assertEqual(clean.cut, 0.0)


class RunTest(unittest.TestCase):
    """End-to-end tote matches through real providers."""

    def test_mock_packs_offered_in_order(self) -> None:
        offered = offered_catalog(4)
        result = run_tote("Pack wisely.", MockProvider(), 4)
        self.assertIsNone(result.invalid_reason)
        self.assertEqual(list(result.packing), list(offered))

    def test_provider_receives_reply_shape_suffix(self) -> None:
        seen: list[str] = []

        class CapturingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                seen.append(system_prompt)
                return super().complete(system_prompt, state_json)

        run_tote("Pack wisely.", CapturingProvider([pack(["rope"])]), 4)
        self.assertEqual(len(seen), 1)
        self.assertTrue(seen[0].startswith("Pack wisely.\n\n"))
        self.assertIn(TOTE_REPLY_SHAPE, seen[0])

    def test_mock_ignores_prompt_text(self) -> None:
        first = run_tote("Heavies at the bottom.", MockProvider(), 4)
        second = run_tote("Fragile things on top please.", MockProvider(), 4)
        self.assertEqual(list(first.packing), list(second.packing))

    def test_mock_answers_tote_state_with_packing_json(self) -> None:
        import json as jsonlib

        offered = list(offered_catalog(7))
        state = jsonlib.dumps({"capacity_kg": 10.0, "offered": offered})
        text = MockProvider().complete("Pack wisely.", state).text
        self.assertEqual(jsonlib.loads(text), {"packing": offered})

    def test_pack_records_thinking(self) -> None:
        class ThinkingPacker(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                offered = list(offered_catalog(4))
                return ProviderCompletion(
                    text=pack(offered),
                    prompt_tokens=200,
                    completion_tokens=500,
                    reasoning_tokens=420,
                )

        result = run_tote("Pack wisely.", ThinkingPacker([pack(["rope"])]), 4)
        self.assertIsNone(result.invalid_reason)
        self.assertEqual(result.thinking_tokens, 420)
        self.assertEqual(result.tokens_used, 200 + (500 - 420))

    def test_sharp_beats_naive_across_probe_seeds(self) -> None:
        for seed in range(1, 11):
            offer = offered_catalog(seed)
            naive = run_tote(
                "Pack wisely.", ScriptedProvider([pack(list(offer[:5]))]), seed
            )
            sharp = run_tote(
                "Pack wisely.", ScriptedProvider([pack(_sharp_order(offer))]), seed
            )
            self.assertGreaterEqual(sharp.score, naive.score)


class FreeSlotsTest(unittest.TestCase):
    """Up to two non-offered catalog ids pack; strangers never do."""

    def test_two_wildcards_accepted_third_rejected(self) -> None:
        from aim_sim.tote import BY_ID

        offer = offered_catalog(4)
        outside = [item_id for item_id in BY_ID if item_id not in offer]
        packing, reason = parse_packing(pack([offer[0], outside[0], outside[1]]), offer)
        self.assertIsNone(reason)
        self.assertEqual(packing, [offer[0], outside[0], outside[1]])
        _, too_many = parse_packing(
            pack([offer[0], outside[0], outside[1], outside[2]]), offer
        )
        self.assertEqual(too_many, "too_many_wildcards")

    def test_unknown_catalog_id_still_rejected(self) -> None:
        offer = offered_catalog(4)
        _, reason = parse_packing(pack([offer[0], "nope"]), offer)
        self.assertEqual(reason, "unknown_item")


class BadgeTest(unittest.TestCase):
    """Challenge badges reward light, careful, and clean packing."""

    def test_light_and_spotless_packing(self) -> None:
        graded = grade_packing(4, ["tape", "sandpaper", "level"], offered_catalog(4))
        self.assertIn(BADGE_LIGHT_PACK, graded.badges)
        self.assertIn(BADGE_SPOTLESS, graded.badges)
        self.assertNotIn(BADGE_FRAGILE_TOP, graded.badges)

    def test_fragile_top_three(self) -> None:
        graded = grade_packing(
            4,
            ["hammer", "wrench", "level", "tape", "eggs"],
            offered_catalog(4),
        )
        self.assertIn(BADGE_FRAGILE_TOP, graded.badges)
        buried = grade_packing(
            4,
            ["eggs", "hammer", "wrench", "level", "tape"],
            offered_catalog(4),
        )
        self.assertNotIn(BADGE_FRAGILE_TOP, buried.badges)

    def test_damage_denies_spotless(self) -> None:
        graded = grade_packing(4, ["tarp", "paint"], offered_catalog(4))
        self.assertNotIn(BADGE_SPOTLESS, graded.badges)

    def test_bonus_adds_badges_and_scarce(self) -> None:
        offer = offered_catalog(4)
        scarce = scarce_ids(4, offer)
        packing = list(dict.fromkeys(["tape", "sandpaper", *scarce]))
        graded = grade_packing(4, packing, offer)
        packed_scarce = sum(1 for item_id in packing if item_id in scarce)
        expected = round(
            len(graded.badges) * BADGE_BONUS + packed_scarce * SCARCE_BONUS, 2
        )
        self.assertAlmostEqual(graded.bonus, expected)
        self.assertAlmostEqual(
            graded.score,
            max(0.0, round(graded.value - graded.damage + expected, 2)),
        )


class AuditTest(unittest.TestCase):
    """Token budgets bind and skewed usage gets flagged."""

    def test_tiny_budget_rejects_packing(self) -> None:
        config = MatchConfig(token_budget=1)
        result = run_tote("Pack wisely.", MockProvider(), 4, config)
        self.assertEqual(result.invalid_reason, "token_budget_exceeded")
        self.assertEqual(result.score, 0.0)

    def test_mock_usage_is_not_anomalous(self) -> None:
        result = run_tote("Pack wisely.", MockProvider(), 4)
        self.assertFalse(result.usage_anomaly)

    def test_under_reported_usage_flags_anomaly(self) -> None:
        class QuietProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=pack(["rope"]), prompt_tokens=1, completion_tokens=1
                )

        result = run_tote("Pack wisely.", QuietProvider([pack(["rope"])]), 4)
        self.assertTrue(result.usage_anomaly)
        self.assertIsNone(result.invalid_reason)

    def test_thinking_pack_bills_game_tokens(self) -> None:
        class ThinkingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=pack(["rope"]),
                    prompt_tokens=120,
                    completion_tokens=1900,
                    reasoning_tokens=1750,
                )

        config = MatchConfig(token_budget=500)
        result = run_tote("Pack wisely.", ThinkingProvider([pack(["rope"])]), 4, config)
        self.assertIsNone(result.invalid_reason)
        self.assertFalse(result.usage_anomaly)
        self.assertEqual(result.tokens_used, 270)


def _sharp_order(offer: tuple[str, ...]) -> list[str]:
    """Heavies bottom, liquids low, fragile top, rope above the saw."""
    from aim_sim.tote import BY_ID

    def rank(item_id: str) -> tuple[int, float, str]:
        item = BY_ID[item_id]
        if item.fragile:
            band = 3
        elif "liquid" in item.tags:
            band = 0
        elif item.id == "rope":
            band = 2
        else:
            band = 1
        return (band, -item.weight, item_id)

    return sorted(offer, key=rank)


if __name__ == "__main__":
    unittest.main()
