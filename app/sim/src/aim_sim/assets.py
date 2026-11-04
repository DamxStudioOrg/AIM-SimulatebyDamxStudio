"""Challenge asset schema: visual-only 3D dressing params, strictly validated.

Version 2 carries palette swatches, scenery counts (lanterns joined in
v2), moon dressing with a halo ring, and tower height plus width
scales. Nothing here touches gameplay: the simulator never reads
these params, and unknown keys are rejected so gameplay smuggling
cannot ride along. Version 1 params still validate and upgrade with
quiet defaults. Keep in sync with web/lib/stage3d.ts SWATCH_IDS and
server/app/Http/Controllers/ProposalController.php ASSET_SWATCHES.

Pure standard library.
"""

from __future__ import annotations

import math
from collections.abc import Mapping

ASSET_SCHEMA_VERSION = 2

SWATCH_IDS: tuple[str, ...] = (
    "sky",
    "ground",
    "street",
    "far",
    "mid",
    "water",
    "heat",
    "leader",
    "brand",
    "ink",
    "moon",
    "crater",
    "coral",
    "mint",
    "gold",
    "grape",
)

PALETTE_KEYS: tuple[str, ...] = ("moon", "crater", "accent", "crane")

SCENERY_BOUNDS: dict[str, tuple[int, int]] = {
    "trees": (0, 24),
    "clouds": (0, 8),
    "beacons": (0, 12),
    "pennants": (0, 20),
    "shrooms": (0, 16),
    "lanterns": (0, 12),
}

V1_SCENERY_KEYS = ("trees", "clouds", "beacons", "pennants", "shrooms")

MOON_CRATERS_BOUNDS = (0, 24)
MOON_SIZE_BOUNDS = (0.7, 1.4)
MOON_HALO_BOUNDS = (0.0, 1.0)
TOWER_HEIGHT_SCALE_BOUNDS = (0.6, 1.6)
TOWER_WIDTH_SCALE_BOUNDS = (0.6, 1.6)

ASSET_DRAFT_SYSTEM = (
    "Design 3D stage dressing for a goofy low-poly moon arena. Reply with "
    'JSON only, exactly this shape: {"version": 2, "palette": {"moon": id, '
    '"crater": id, "accent": id, "crane": id}, "scenery": {"trees": n, '
    '"clouds": n, "beacons": n, "pennants": n, "shrooms": n, "lanterns": n}, '
    '"moon": {"craters": n, "size": n, "halo": n}, '
    '"towers": {"heightScale": n, "widthScale": n}}. '
    "Palette ids must come from: sky, ground, street, far, mid, water, heat, "
    "leader, brand, ink, moon, crater, coral, mint, gold, grape. Counts are "
    "integers: trees 0-24, clouds 0-8, beacons 0-12, pennants 0-20, shrooms "
    "0-16, lanterns 0-12, craters 0-24. Size is 0.7-1.4, halo 0-1, "
    "heightScale and widthScale 0.6-1.6. No other keys."
)


class InvalidAssetsError(ValueError):
    """Raised when asset params break the versioned schema."""


def validate_assets(data: object) -> dict[str, object]:
    """Validate raw asset params; return the normalized v2 mapping.

    Version 1 params upgrade with quiet defaults (no lanterns, no
    halo, unit tower width).

    Raises:
        InvalidAssetsError: If any key, type, or bound is invalid.

    """
    if not isinstance(data, Mapping):
        msg = "assets must be a JSON object"
        raise InvalidAssetsError(msg)
    if set(data.keys()) != {"version", "palette", "scenery", "moon", "towers"}:
        msg = "assets must hold exactly version, palette, scenery, moon, towers"
        raise InvalidAssetsError(msg)
    legacy = data["version"] == 1
    if not legacy and data["version"] != ASSET_SCHEMA_VERSION:
        msg = "assets version must be 1 or 2"
        raise InvalidAssetsError(msg)
    palette = _validate_palette(data["palette"])
    scenery = _validate_scenery(data["scenery"], legacy=legacy)
    moon = _validate_moon(data["moon"], legacy=legacy)
    towers = _validate_towers(data["towers"], legacy=legacy)
    return {
        "version": ASSET_SCHEMA_VERSION,
        "palette": palette,
        "scenery": scenery,
        "moon": moon,
        "towers": towers,
    }


def _validate_palette(data: object) -> dict[str, str]:
    if not isinstance(data, Mapping) or set(data.keys()) != set(PALETTE_KEYS):
        msg = f"palette must hold exactly {sorted(PALETTE_KEYS)}"
        raise InvalidAssetsError(msg)
    clean: dict[str, str] = {}
    for key in PALETTE_KEYS:
        swatch = data[key]
        if not isinstance(swatch, str) or swatch not in SWATCH_IDS:
            msg = f"unknown swatch: {swatch!r}"
            raise InvalidAssetsError(msg)
        clean[key] = swatch
    return clean


def _validate_scenery(data: object, *, legacy: bool) -> dict[str, int]:
    wanted = set(V1_SCENERY_KEYS) if legacy else set(SCENERY_BOUNDS)
    if not isinstance(data, Mapping) or set(data.keys()) != wanted:
        msg = f"scenery must hold exactly {sorted(wanted)}"
        raise InvalidAssetsError(msg)
    clean: dict[str, int] = {}
    for key, (low, high) in SCENERY_BOUNDS.items():
        if legacy and key == "lanterns":
            clean[key] = 0
            continue
        count = data[key]
        if isinstance(count, bool) or not isinstance(count, int):
            msg = f"scenery[{key}] must be an integer"
            raise InvalidAssetsError(msg)
        if count < low or count > high:
            msg = f"scenery[{key}] must be {low}-{high}, got {count}"
            raise InvalidAssetsError(msg)
        clean[key] = count
    return clean


def _validate_moon(data: object, *, legacy: bool) -> dict[str, object]:
    wanted = {"craters", "size"} if legacy else {"craters", "size", "halo"}
    if not isinstance(data, Mapping) or set(data.keys()) != wanted:
        msg = f"moon must hold exactly {sorted(wanted)}"
        raise InvalidAssetsError(msg)
    craters = data["craters"]
    low, high = MOON_CRATERS_BOUNDS
    if isinstance(craters, bool) or not isinstance(craters, int):
        msg = "moon[craters] must be an integer"
        raise InvalidAssetsError(msg)
    if craters < low or craters > high:
        msg = f"moon[craters] must be {low}-{high}, got {craters}"
        raise InvalidAssetsError(msg)
    halo = 0.0 if legacy else _finite(data["halo"], "moon[halo]", *MOON_HALO_BOUNDS)
    return {
        "craters": craters,
        "size": _finite(data["size"], "moon[size]", *MOON_SIZE_BOUNDS),
        "halo": halo,
    }


def _validate_towers(data: object, *, legacy: bool) -> dict[str, float]:
    wanted = {"heightScale"} if legacy else {"heightScale", "widthScale"}
    if not isinstance(data, Mapping) or set(data.keys()) != wanted:
        msg = f"towers must hold exactly {sorted(wanted)}"
        raise InvalidAssetsError(msg)
    width = (
        1.0
        if legacy
        else _finite(
            data["widthScale"], "towers[widthScale]", *TOWER_WIDTH_SCALE_BOUNDS
        )
    )
    return {
        "heightScale": _finite(
            data["heightScale"], "towers[heightScale]", *TOWER_HEIGHT_SCALE_BOUNDS
        ),
        "widthScale": width,
    }


def _finite(data: object, label: str, low: float, high: float) -> float:
    if isinstance(data, bool) or not isinstance(data, int | float):
        msg = f"{label} must be a number"
        raise InvalidAssetsError(msg)
    value = float(data)
    if not math.isfinite(value) or value < low or value > high:
        msg = f"{label} must be {low}-{high}, got {data!r}"
        raise InvalidAssetsError(msg)
    return value
