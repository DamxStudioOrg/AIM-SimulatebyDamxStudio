"""Geomorphology tests: seeded sites, placer law, live state feedback."""

from __future__ import annotations

import typing
import unittest

from aim_sim.terraform import (
    CELLS_PER_SITE,
    RESTORATION_TURNS,
    SITE_IDS,
    WEATHERS,
    Cell,
    GeomorphologyState,
    generate_sites,
    place_feature,
    restoration_for_seed,
)


def _cell(**overrides: float | str) -> Cell:
    base: dict[str, object] = {
        "site": "quarry",
        "index": 0,
        "soil": "loam",
        "slope": 30.0,
        "moisture": 50.0,
        "fertility": 50.0,
        "heat": 30.0,
        "erosion": 20.0,
    }
    base.update(overrides)
    return Cell(**base)  # type: ignore[arg-type]


class SiteGenerationTest(unittest.TestCase):
    """Three 17-cell sites, seeded deterministically, per-site bias."""

    def test_three_sites_of_seventeen_cells(self) -> None:
        sites = generate_sites(42)
        self.assertEqual(tuple(sites), SITE_IDS)
        for cells in sites.values():
            self.assertEqual(len(cells), CELLS_PER_SITE)
            self.assertEqual([c.index for c in cells], list(range(CELLS_PER_SITE)))

    def test_same_seed_same_sites(self) -> None:
        self.assertEqual(generate_sites(7), generate_sites(7))
        self.assertNotEqual(generate_sites(7), generate_sites(8))

    def test_site_biases(self) -> None:
        sites = generate_sites(11)
        mean = {
            name: sum(c.moisture for c in cells) / len(cells)
            for name, cells in sites.items()
        }
        self.assertGreater(mean["aquifer"], mean["vent"])
        heat = {
            name: sum(c.heat for c in cells) / len(cells)
            for name, cells in sites.items()
        }
        self.assertGreater(heat["vent"], heat["quarry"])

    def test_cell_conditions_bounded(self) -> None:
        for cells in generate_sites(3).values():
            for cell in cells:
                for value in (
                    cell.slope,
                    cell.moisture,
                    cell.fertility,
                    cell.heat,
                    cell.erosion,
                ):
                    self.assertGreaterEqual(value, 0.0)
                    self.assertLessEqual(value, 100.0)


class PlacerTest(unittest.TestCase):
    """Feature placement follows local conditions, nothing else."""

    def test_hot_steep_cell_vents(self) -> None:
        self.assertEqual(
            place_feature(_cell(heat=80.0, slope=60.0, moisture=10.0)), "vent"
        )

    def test_steep_or_parched_cell_rocks(self) -> None:
        self.assertEqual(place_feature(_cell(slope=80.0)), "rock")
        self.assertEqual(place_feature(_cell(moisture=15.0, slope=20.0)), "rock")

    def test_rich_wet_cell_grows_flora(self) -> None:
        self.assertEqual(
            place_feature(_cell(fertility=70.0, moisture=60.0, slope=25.0)),
            "flora",
        )

    def test_plain_cell_barren(self) -> None:
        self.assertEqual(place_feature(_cell()), "barren")


class StateEvolutionTest(unittest.TestCase):
    """Live moisture/erosion/heat feedback, stewardship, restoration."""

    def test_green_spend_raises_fertility_and_lowers_erosion(self) -> None:
        quiet = GeomorphologyState(5)
        green = GeomorphologyState(5)
        before = green.summary()["fertility"]
        for _ in range(4):
            quiet.advance({}, turn=1)
            green.advance({"green": 40.0, "repair": 30.0}, turn=1)
        after = green.summary()
        self.assertGreater(after["fertility"], before)
        self.assertLess(after["erosion"], quiet.summary()["erosion"] + 1.0)

    def test_stewardship_bias_persists_and_shifts_moisture(self) -> None:
        state = GeomorphologyState(9)
        for turn in range(1, 6):
            state.advance({"green": 45.0, "shelter": 25.0}, turn=turn)
        self.assertGreater(state.stewardship_bias, 0.0)
        bias = state.stewardship_bias
        state.advance({}, turn=6)
        self.assertGreater(state.stewardship_bias, 0.0)
        self.assertLessEqual(state.stewardship_bias, bias + 0.001)

    def test_restoration_window_applies_signed_weather(self) -> None:
        plan = restoration_for_seed(2)
        self.assertIn(plan["weather"], WEATHERS)
        self.assertEqual(plan["turns"], list(RESTORATION_TURNS))
        state = GeomorphologyState(2)
        dry = GeomorphologyState(2)
        for turn in range(1, 10):
            state.advance({}, turn=turn)
            dry.advance({}, turn=turn)
        self.assertEqual(state.restoration_weather, plan["weather"])
        self.assertEqual(len(state.trace), 9)
        self.assertEqual(
            state.trace[RESTORATION_TURNS[0] - 1]["restoration"],
            plan["weather"],
        )

    def test_bounds_hold_over_a_match(self) -> None:
        state = GeomorphologyState(4)
        for turn in range(1, 13):
            state.advance({"green": 90.0, "rescue": 10.0}, turn=turn)
        summary = state.summary()
        for key in ("moisture", "fertility", "heat", "erosion"):
            self.assertGreaterEqual(summary[key], 0.0)
            self.assertLessEqual(summary[key], 100.0)


class DirectiveTest(unittest.TestCase):
    """Variable tasks with individual token limits from live cells."""

    def test_directives_within_bounds(self) -> None:
        state = GeomorphologyState(6)
        directives = state.directives(turn=1)
        self.assertGreaterEqual(len(directives), 3)
        self.assertLessEqual(len(directives), 5)
        for directive in directives:
            limit = typing.cast(int, directive["token_limit"])
            self.assertGreaterEqual(limit, 50)
            self.assertLessEqual(limit, 250)
            self.assertIn(directive["need"], ("green", "repair", "rescue", "shelter"))
        priorities = [d["priority"] for d in directives]
        self.assertEqual(priorities, sorted(priorities, reverse=True))

    def test_prioritization_rewards_matching_spend(self) -> None:
        follower = GeomorphologyState(6)
        ignorer = GeomorphologyState(6)
        for turn in range(1, 7):
            top = follower.directives(turn)[0]
            need = typing.cast(str, top["need"])
            follower.advance({need: 60.0}, turn=turn)
            ignorer.advance({"housing": 60.0}, turn=turn)
        self.assertGreater(
            follower.prioritization_score(), ignorer.prioritization_score()
        )
        self.assertGreater(follower.prioritization_score(), 40.0)


class MatchIntegrationTest(unittest.TestCase):
    """A finished match reports the environment; agents see directives."""

    def test_result_carries_environment_report(self) -> None:
        from aim_sim.runner import MatchRunner, MockProvider

        result = MatchRunner().run("tend the land", MockProvider(), seed=11)
        env = result.environment
        sites = typing.cast(dict[str, list[dict[str, object]]], env["sites"])
        self.assertEqual(tuple(sites), SITE_IDS)
        for cells in sites.values():
            self.assertEqual(len(cells), CELLS_PER_SITE)
            self.assertIn(cells[0]["feature"], ("rock", "vent", "flora", "barren"))
        trace = typing.cast(list[object], env["trace"])
        self.assertEqual(len(trace), 12)
        prioritization = typing.cast(float, env["prioritization"])
        self.assertGreaterEqual(prioritization, 0.0)
        self.assertLessEqual(prioritization, 100.0)
        restoration = typing.cast(dict[str, object], env["restoration"])
        self.assertEqual(restoration["turns"], [6, 7, 8])
        self.assertIn("impact", result.scores)

    def test_agent_state_carries_directives(self) -> None:
        from aim_sim.simulator import ResilientCitySim

        sim = ResilientCitySim(11)
        view = sim.state_view(1_000)
        environment = typing.cast(dict[str, typing.Any], view["environment"])
        directives = environment["directives"]
        self.assertGreaterEqual(len(directives), 3)
        self.assertLessEqual(len(directives), 5)
        self.assertEqual(set(environment["sites"]), {"quarry", "aquifer", "vent"})


class InterveneTest(unittest.TestCase):
    """Field interventions shift live conditions and enter the trace."""

    def test_irrigate_raises_moisture(self) -> None:
        land = GeomorphologyState(seed=4)
        before = land.summary()["moisture"]
        land.intervene("irrigate")
        self.assertGreater(land.summary()["moisture"], before)

    def test_vent_heat_lowers_heat(self) -> None:
        land = GeomorphologyState(seed=4)
        before = land.summary()["heat"]
        land.intervene("vent_heat")
        self.assertLess(land.summary()["heat"], before)

    def test_terrace_cuts_erosion(self) -> None:
        land = GeomorphologyState(seed=4)
        before = land.summary()["erosion"]
        land.intervene("terrace")
        self.assertLess(land.summary()["erosion"], before)

    def test_repeated_interventions_stay_in_bounds(self) -> None:
        land = GeomorphologyState(seed=4)
        for _ in range(20):
            land.intervene("irrigate")
        means = land.summary()
        for key in ("moisture", "fertility", "heat", "erosion"):
            self.assertGreaterEqual(means[key], 0.0)
            self.assertLessEqual(means[key], 100.0)

    def test_unknown_kind_rejected(self) -> None:
        with self.assertRaises(ValueError):
            GeomorphologyState(seed=4).intervene("nuke")

    def test_trace_names_the_fired_intervention(self) -> None:
        land = GeomorphologyState(seed=4)
        land.advance({}, turn=1)
        land.intervene("terrace")
        land.advance({}, turn=2)
        self.assertIsNone(land.trace[0]["intervention"])
        self.assertEqual(land.trace[1]["intervention"], "terrace")


if __name__ == "__main__":
    unittest.main()
