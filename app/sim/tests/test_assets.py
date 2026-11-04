"""Challenge asset schema tests: visual-only params, strictly validated."""

from __future__ import annotations

import unittest

from aim_sim.assets import (
    InvalidAssetsError,
    validate_assets,
)


def _valid() -> dict[str, object]:
    return {
        "version": 2,
        "palette": {
            "moon": "moon",
            "crater": "crater",
            "accent": "brand",
            "crane": "gold",
        },
        "scenery": {
            "trees": 12,
            "clouds": 4,
            "beacons": 6,
            "pennants": 10,
            "shrooms": 5,
            "lanterns": 3,
        },
        "moon": {"craters": 14, "size": 1.0, "halo": 0.5},
        "towers": {"heightScale": 1.0, "widthScale": 1.2},
    }


def _legacy() -> dict[str, object]:
    return {
        "version": 1,
        "palette": {
            "moon": "moon",
            "crater": "crater",
            "accent": "brand",
            "crane": "gold",
        },
        "scenery": {
            "trees": 12,
            "clouds": 4,
            "beacons": 6,
            "pennants": 10,
            "shrooms": 5,
        },
        "moon": {"craters": 14, "size": 1.0},
        "towers": {"heightScale": 1.0},
    }


class ValidateAssetsTest(unittest.TestCase):
    """Only exact-shape params validate; v1 upgrades, else rejected."""

    def test_valid_params_normalize(self) -> None:
        params = validate_assets(_valid())
        self.assertEqual(params["version"], 2)
        palette = params["palette"]
        assert isinstance(palette, dict)
        self.assertEqual(palette["crane"], "gold")
        scenery = params["scenery"]
        assert isinstance(scenery, dict)
        self.assertEqual(scenery["lanterns"], 3)

    def test_legacy_params_upgrade_quietly(self) -> None:
        params = validate_assets(_legacy())
        self.assertEqual(params["version"], 2)
        scenery = params["scenery"]
        assert isinstance(scenery, dict)
        self.assertEqual(scenery["lanterns"], 0)
        moon = params["moon"]
        assert isinstance(moon, dict)
        self.assertEqual(moon["halo"], 0.0)
        towers = params["towers"]
        assert isinstance(towers, dict)
        self.assertEqual(towers["widthScale"], 1.0)

    def test_non_mapping_rejected(self) -> None:
        for raw in ("dressing", 7, None, [1]):
            with self.subTest(raw=raw), self.assertRaises(InvalidAssetsError):
                validate_assets(raw)

    def test_wrong_version_rejected(self) -> None:
        for version in (0, 3, "1", None):
            with self.subTest(version=version):
                raw = _valid()
                raw["version"] = version
                with self.assertRaises(InvalidAssetsError):
                    validate_assets(raw)

    def test_unknown_top_level_key_rejected(self) -> None:
        raw = _valid()
        raw["gameplay"] = {"shocks": 9}
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_missing_section_rejected(self) -> None:
        raw = _valid()
        del raw["moon"]
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_unknown_swatch_rejected(self) -> None:
        raw = _valid()
        palette = raw["palette"]
        assert isinstance(palette, dict)
        palette["accent"] = "javascript:alert(1)"
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_scenery_bounds_enforced(self) -> None:
        for key, bad in (
            ("trees", -1),
            ("trees", 25),
            ("clouds", 9),
            ("beacons", 13),
            ("pennants", 21),
            ("shrooms", 17),
            ("lanterns", 13),
        ):
            with self.subTest(key=key, bad=bad):
                raw = _valid()
                scenery = raw["scenery"]
                assert isinstance(scenery, dict)
                scenery[key] = bad
                with self.assertRaises(InvalidAssetsError):
                    validate_assets(raw)

    def test_scenery_must_be_integers(self) -> None:
        raw = _valid()
        scenery = raw["scenery"]
        assert isinstance(scenery, dict)
        scenery["trees"] = 2.5
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_moon_and_tower_ranges_enforced(self) -> None:
        raw = _valid()
        moon = raw["moon"]
        assert isinstance(moon, dict)
        moon["size"] = 1.5
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)
        raw = _valid()
        towers = raw["towers"]
        assert isinstance(towers, dict)
        towers["heightScale"] = 0.5
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)
        raw = _valid()
        moon = raw["moon"]
        assert isinstance(moon, dict)
        moon["halo"] = 1.5
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)
        raw = _valid()
        towers = raw["towers"]
        assert isinstance(towers, dict)
        towers["widthScale"] = 0.5
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_cross_version_keys_rejected(self) -> None:
        raw = _legacy()
        scenery = raw["scenery"]
        assert isinstance(scenery, dict)
        scenery["lanterns"] = 2
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)
        raw = _valid()
        towers = raw["towers"]
        assert isinstance(towers, dict)
        del towers["widthScale"]
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_non_finite_numbers_rejected(self) -> None:
        raw = _valid()
        moon = raw["moon"]
        assert isinstance(moon, dict)
        moon["size"] = float("inf")
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)

    def test_booleans_are_not_numbers(self) -> None:
        raw = _valid()
        scenery = raw["scenery"]
        assert isinstance(scenery, dict)
        scenery["trees"] = True
        with self.assertRaises(InvalidAssetsError):
            validate_assets(raw)


if __name__ == "__main__":
    unittest.main()
