/**
 * Centralised stage design tokens for the moon stage.
 * Single source of truth for magic numbers used across stage3d.ts
 * and city-scene.ts to satisfy AGENTS.md no-magic-numbers rule.
 */
export const STAGE = {
  MOON: {
    RADIUS: 17,
    LIFT: 4.6,
    REF_PX: 520,
  },
  COMPANION: {
    X: 15,
    Y: 1,
    Z: -6,
    RADIUS: 5.5,
    SPIN_PER_MS: (Math.PI * 2) / 90000,
    REST: 0.6,
    MIN_SCALE: 0.38,
    MAX_SCALE: 1.45,
    EASE: 0.1,
  },
  TOWER: {
    ARC_R: 6.2,
    ARC_STEP: 0.21,
  },
  DRESS_RING: {
    IN: 9,
    OUT: 13.5,
  },
  GROVE: {
    X_MIN: -10,
    X_MAX: 10,
    Z_MIN: -5.8,
    Z_MAX: -3.4,
    SCALE_MIN: 0.8,
    SCALE_MAX: 1.5,
  },
  HUT: {
    X: 7.5,
    Z: -1.5,
  },
  VEGETATION: {
    LUSH_GREEN: 20,
    ARID_CACTI: 6,
    // Must stay below the sim's FLORA_MAX_SLOPE (45): the sim only
    // grows flora on gentler ground, so a cutoff at or above that
    // ceiling makes terrain cacti unreachable.
    CACTUS_SLOPE: 30,
    LUSH_LEAF: 0x3f9e4d,
    DRY_LEAF: 0x8a9e4d,
    SCORCH_LEAF: 0x6b4a2c,
  },
  // Swatch ids are the cross-stack contract (sim SWATCH_IDS, Laravel
  // ASSET_SWATCHES): lowercase keys, in canonical order. Do not rename.
  PALETTE: {
    sky: 0x24102e,
    ground: 0x2e4a2f,
    street: 0x3a2c3a,
    far: 0x35204a,
    mid: 0x4a2c5a,
    water: 0x4fc3e0,
    heat: 0xff9a3d,
    leader: 0xffe64d,
    brand: 0xff4f4f,
    ink: 0xffffff,
    moon: 0xcfc4bb,
    crater: 0x9a8d84,
    coral: 0xff8a7a,
    mint: 0x7fe8c3,
    gold: 0xffd23f,
    grape: 0xb47aff,
  },
  TOWER_COLORS: {
    housing: 0xff6b5e,
    transit: 0x4fa3ff,
    health: 0x5ee08a,
    green: 0x8ee04f,
    reserves: 0xffc94f,
    rescue: 0xff4f4f,
    shelter: 0xb47aff,
    repair: 0x4fe0d8,
  },
} as const;
