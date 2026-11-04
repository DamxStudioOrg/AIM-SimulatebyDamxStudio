"""Contract validation tests: every rejection rule in models.py."""

from __future__ import annotations

import unittest

from aim_sim.models import (
    AgentAction,
    Intervention,
    InvalidActionError,
    validate_interventions,
)
from tests.support import BALANCED_ALLOCATION


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "allocation": dict(BALANCED_ALLOCATION),
        "policies": [],
        "note": "",
    }
    base.update(overrides)
    return base


class ValidateActionTest(unittest.TestCase):
    """AgentAction.from_untrusted accepts the contract, rejects the rest."""

    def test_valid_action_parses(self) -> None:
        action = AgentAction.from_untrusted(_payload())
        self.assertAlmostEqual(sum(action.allocation.values()), 100.0)
        self.assertEqual(action.policies, ())
        self.assertEqual(action.note, "")

    def test_valid_policies_and_note(self) -> None:
        action = AgentAction.from_untrusted(
            _payload(policies=["open_shelters", "curfew"], note="hold the east")
        )
        self.assertEqual(action.policies, ("open_shelters", "curfew"))

    def test_non_object_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted([1, 2, 3])

    def test_wrong_sum_rejected(self) -> None:
        alloc = dict(BALANCED_ALLOCATION)
        alloc["housing"] = 99.0
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(allocation=alloc))

    def test_missing_key_rejected(self) -> None:
        alloc = dict(BALANCED_ALLOCATION)
        del alloc["repair"]
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(allocation=alloc))

    def test_bool_value_rejected(self) -> None:
        alloc = dict(BALANCED_ALLOCATION)
        alloc["green"] = True  # bool is an int; the contract rejects it explicitly
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(allocation=alloc))

    def test_negative_value_rejected(self) -> None:
        alloc = dict(BALANCED_ALLOCATION)
        alloc["green"] = -5.0
        alloc["reserves"] = 20.0
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(allocation=alloc))

    def test_unknown_policy_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(policies=["bribe_everyone"]))

    def test_three_policies_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(
                _payload(policies=["curfew", "open_shelters", "ration_water"])
            )

    def test_duplicate_policy_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(policies=["curfew", "curfew"]))

    def test_long_note_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            AgentAction.from_untrusted(_payload(note="x" * 281))


class InterventionTest(unittest.TestCase):
    """Field-plan entries validate turn, kind, and match-level shape."""

    def test_valid_entry_accepted(self) -> None:
        entry = Intervention.from_untrusted({"turn": 5, "kind": "irrigate"})
        self.assertEqual(entry.turn, 5)
        self.assertEqual(entry.kind, "irrigate")

    def test_non_mapping_rejected(self) -> None:
        for raw in ("irrigate", 5, None, ["turn", 5]):
            with self.subTest(raw=raw), self.assertRaises(InvalidActionError):
                Intervention.from_untrusted(raw)

    def test_turn_outside_match_rejected(self) -> None:
        for turn in (0, 13, -1, "5", True, None):
            with self.subTest(turn=turn), self.assertRaises(InvalidActionError):
                Intervention.from_untrusted({"turn": turn, "kind": "terrace"})

    def test_unknown_kind_rejected(self) -> None:
        for kind in ("nuke", "", 7, None):
            with self.subTest(kind=kind), self.assertRaises(InvalidActionError):
                Intervention.from_untrusted({"turn": 4, "kind": kind})

    def test_plan_of_three_distinct_turns_accepted(self) -> None:
        plan = validate_interventions(
            [
                {"turn": 2, "kind": "irrigate"},
                {"turn": 5, "kind": "vent_heat"},
                {"turn": 9, "kind": "terrace"},
            ]
        )
        self.assertEqual([entry.turn for entry in plan], [2, 5, 9])

    def test_empty_plan_accepted(self) -> None:
        self.assertEqual(validate_interventions([]), ())

    def test_fourth_entry_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            validate_interventions(
                [
                    {"turn": 1, "kind": "irrigate"},
                    {"turn": 2, "kind": "irrigate"},
                    {"turn": 3, "kind": "irrigate"},
                    {"turn": 4, "kind": "irrigate"},
                ]
            )

    def test_two_entries_on_one_turn_rejected(self) -> None:
        with self.assertRaises(InvalidActionError):
            validate_interventions(
                [
                    {"turn": 5, "kind": "irrigate"},
                    {"turn": 5, "kind": "terrace"},
                ]
            )


if __name__ == "__main__":
    unittest.main()
