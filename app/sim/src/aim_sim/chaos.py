"""Seeded Fourier chaos field: deterministic sum-of-sinusoids noise.

One reusable noise source for "same prompt, varied world" runs: given a
seed it returns a fixed pseudo-random field in [-1, 1] built from a few
sine modes with seeded phases. Pure stdlib (math + random), no new deps.

The field is a weighted mean of sines, so every sample stays within
[-1, 1] by construction. At chaos level 0 every consumer skips the
field entirely, so existing seeds replay exactly; higher levels scale
the field's effect up. The field draws from its own ``aim-chaos-{seed}``
random stream, never the match RNG, so enabling chaos cannot shift the
default draw order.
"""

from __future__ import annotations

import math
import random

CHAOS_FIELD_LEN = 64
CHAOS_MODES = 5


def fourier_field(
    seed: int,
    length: int = CHAOS_FIELD_LEN,
    modes: int = CHAOS_MODES,
) -> tuple[float, ...]:
    """Deterministic noise field in [-1, 1] for ``seed``.

    Amplitudes decay as 1/k over ``modes`` harmonics; phases are seeded
    uniform draws. Sampling at mid-cell ``(i + 0.5) / length`` keeps the
    lattice from aligning with any single mode's zeros.
    """
    rng = random.Random(f"aim-chaos-{seed}")  # noqa: S311 -- seeded draw, not crypto.
    phases = [rng.uniform(0.0, 2.0 * math.pi) for _ in range(modes)]
    amps = [1.0 / (mode + 1) for mode in range(modes)]
    total = sum(amps)
    field: list[float] = []
    for i in range(length):
        t = (i + 0.5) / length
        value = sum(
            amp * math.sin(2.0 * math.pi * (mode + 1) * t + phase)
            for mode, (amp, phase) in enumerate(zip(amps, phases, strict=True))
        )
        field.append(value / total)
    return tuple(field)
