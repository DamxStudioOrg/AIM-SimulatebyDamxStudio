"""What-if previews replay deterministically and isolate one turn."""

import unittest

from aim_sim.models import InvalidActionError
from aim_sim.whatif import what_if

BALANCED = {
    "housing": 15.0,
    "transit": 10.0,
    "health": 15.0,
    "green": 10.0,
    "reserves": 15.0,
    "rescue": 12.0,
    "shelter": 11.0,
    "repair": 12.0,
}
ALL_RESERVES = {
    "housing": 0.0,
    "transit": 0.0,
    "health": 0.0,
    "green": 0.0,
    "reserves": 100.0,
    "rescue": 0.0,
    "shelter": 0.0,
    "repair": 0.0,
}


def recorded() -> list[dict[str, float] | None]:
    return [dict(BALANCED) for _ in range(12)]


class WhatIfTest(unittest.TestCase):
    """One swapped turn: zero delta for identity, stable delta otherwise."""

    def test_same_allocation_has_zero_delta(self) -> None:
        out = what_if(7, recorded(), 5, dict(BALANCED))
        self.assertEqual(out["impact_delta"], 0.0)
        self.assertEqual(out["baseline"], out["variant"])

    def test_swap_changes_the_preview_and_is_deterministic(self) -> None:
        first = what_if(7, recorded(), 5, dict(ALL_RESERVES))
        second = what_if(7, recorded(), 5, dict(ALL_RESERVES))
        self.assertEqual(first, second)
        self.assertNotEqual(first["impact_delta"], 0.0)

    def test_bad_inputs_raise(self) -> None:
        with self.assertRaises(ValueError):
            what_if(7, recorded()[:3], 1, dict(BALANCED))
        with self.assertRaises(ValueError):
            what_if(7, recorded(), 13, dict(BALANCED))
        with self.assertRaises(InvalidActionError):
            what_if(7, recorded(), 1, {"reserves": 50.0})


if __name__ == "__main__":
    unittest.main()
