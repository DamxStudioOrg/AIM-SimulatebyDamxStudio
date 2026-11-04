/**
 * Dimetric projection + painter primitives for the Canvas2D stage.
 * Pure geometry (project/fit/depth/colors) is unit-pinned here; the
 * thin canvas painters are exercised by the browser suites that
 * render them. World axes match the stage3d layout fns exactly:
 * +x right, +z toward the viewer, +y up.
 */

export interface IsoCamera {
  scale: number;
  cx: number;
  cy: number;
}

export interface IsoBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const COS30 = Math.cos(Math.PI / 6);

/** Orbit view: yaw about Y plus ground squash (the old polar drag). */
export interface IsoView {
  az: number;
  el: number;
}

/** Rest frame: no yaw, classic dimetric squash. */
export const ISO_VIEW_FLAT: IsoView = { az: 0, el: Math.asin(0.5) };

/** World point to screen: yaw the ground plane, then dimetric. */
export function project(
  cam: IsoCamera,
  x: number,
  y: number,
  z: number,
  view: IsoView = ISO_VIEW_FLAT,
): ScreenPoint {
  const cosAz = Math.cos(view.az);
  const sinAz = Math.sin(view.az);
  const xr = x * cosAz + z * sinAz;
  const zr = -x * sinAz + z * cosAz;
  const squash = Math.sin(view.el);
  return {
    x: cam.cx + (xr - zr) * COS30 * cam.scale,
    y: cam.cy + (xr + zr) * squash * cam.scale - y * cam.scale,
  };
}

/**
 * Fit a ground rect plus headroom into a square stage: the larger
 * projected extent touches the margin, the smaller centers. The moon
 * disc itself is bigger than any subject fit — it bleeds off-frame
 * as ground, which is what ground is for.
 */
export function fitCamera(
  sizePx: number,
  bounds: IsoBounds,
  maxY: number,
  margin: number,
): IsoCamera {
  const unit: IsoCamera = { scale: 1, cx: 0, cy: 0 };
  const corners: [number, number, number][] = [];
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      corners.push([x, 0, z], [x, maxY, z]);
    }
  }
  const xs = corners.map(([x, y, z]) => project(unit, x, y, z).x);
  const ys = corners.map(([x, y, z]) => project(unit, x, y, z).y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxYp = Math.max(...ys);
  const scale = (sizePx - margin * 2) / Math.max(maxX - minX, maxYp - minY);
  return {
    scale,
    cx: sizePx / 2 - ((minX + maxX) / 2) * scale,
    cy: sizePx / 2 - ((minY + maxYp) / 2) * scale,
  };
}

/** A ground circle projects to an axis-aligned screen ellipse. */
export function isoDiscRadii(
  r: number,
  scale: number,
  view: IsoView = ISO_VIEW_FLAT,
): { rx: number; ry: number } {
  return {
    rx: Math.SQRT2 * COS30 * r * scale,
    ry: Math.SQRT2 * Math.sin(view.el) * r * scale,
  };
}

/**
 * Painter order: far (small rotated x+z, high on screen) paints
 * first. Follows the orbit yaw so overlap stays correct mid-drag.
 */
export function depthKey(x: number, z: number, view: IsoView = ISO_VIEW_FLAT): number {
  const cosAz = Math.cos(view.az);
  const sinAz = Math.sin(view.az);
  return x * cosAz + z * sinAz - x * sinAz + z * cosAz;
}

/** 0xff4f4f -> "#ff4f4f". */
export function toCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** Scale a hex color toward black (<1) or white (>1), clamped. */
export function shade(hex: number, factor: number): string {
  const channel = (shift: number): number => {
    const value = Math.round(((hex >> shift) & 0xff) * factor);
    return Math.min(255, Math.max(0, value));
  };
  const r = channel(16);
  const g = channel(8);
  const b = channel(0);
  return toCss((r << 16) | (g << 8) | b);
}

export type Ctx = CanvasRenderingContext2D;

/** Fill a screen-space polygon. */
export function poly(ctx: Ctx, points: readonly ScreenPoint[], fill: string): void {
  const first = points[0];
  if (first === undefined) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Stroke a screen-space polyline. */
export function line(
  ctx: Ctx,
  points: readonly ScreenPoint[],
  stroke: string,
  width: number,
): void {
  const first = points[0];
  if (first === undefined) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

export interface IsoBoxOpts {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  top: string;
  left: string;
  right: string;
  /** Base lift for stacked boxes (crane cab, tote walls). */
  y0?: number;
}

/**
 * Orbit yaw bound: inside ±0.7 rad the +x/+z faces stay toward the
 * viewer, so boxes keep painting the same three faces. Wider yaws
 * need per-face visibility — a later extension, not this one.
 */
export const ISO_AZ_LIMIT = 0.7;

/** Solid box on the ground: near faces plus top, painter-ordered. */
export function isoBox(
  ctx: Ctx,
  cam: IsoCamera,
  opts: IsoBoxOpts,
  view: IsoView = ISO_VIEW_FLAT,
): void {
  const x0 = opts.x - opts.w / 2;
  const x1 = opts.x + opts.w / 2;
  const z0 = opts.z - opts.d / 2;
  const z1 = opts.z + opts.d / 2;
  const h = Math.max(opts.h, 0);
  const y0 = opts.y0 ?? 0;
  const p = (x: number, y: number, z: number): ScreenPoint =>
    project(cam, x, y, z, view);
  poly(
    ctx,
    [p(x1, y0, z0), p(x1, y0, z1), p(x1, y0 + h, z1), p(x1, y0 + h, z0)],
    opts.right,
  );
  poly(
    ctx,
    [p(x0, y0, z1), p(x1, y0, z1), p(x1, y0 + h, z1), p(x0, y0 + h, z1)],
    opts.left,
  );
  poly(
    ctx,
    [p(x0, y0 + h, z0), p(x1, y0 + h, z0), p(x1, y0 + h, z1), p(x0, y0 + h, z1)],
    opts.top,
  );
}

export interface IsoDiscOpts {
  x: number;
  z: number;
  r: number;
  y?: number;
  fill: string;
  alpha?: number;
}

/** Flat ground disc (turn markers, blobs, craters) at height y. */
export function isoDisc(
  ctx: Ctx,
  cam: IsoCamera,
  opts: IsoDiscOpts,
  view: IsoView = ISO_VIEW_FLAT,
): void {
  const c = project(cam, opts.x, opts.y ?? 0, opts.z, view);
  const { rx, ry } = isoDiscRadii(opts.r, cam.scale, view);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
  if (opts.alpha !== undefined) {
    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.fillStyle = opts.fill;
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
}

/** Screen-space ball for sky things (companion, puffs): no squash. */
export function ball(
  ctx: Ctx,
  cam: IsoCamera,
  x: number,
  y: number,
  z: number,
  r: number,
  fill: string,
  view: IsoView = ISO_VIEW_FLAT,
): void {
  const c = project(cam, x, y, z, view);
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(r * cam.scale, 0.1), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Vertical line in world space (cables, masts, rain). */
export function vline(
  ctx: Ctx,
  cam: IsoCamera,
  x: number,
  z: number,
  y0: number,
  y1: number,
  stroke: string,
  width: number,
  view: IsoView = ISO_VIEW_FLAT,
): void {
  line(
    ctx,
    [project(cam, x, y0, z, view), project(cam, x, y1, z, view)],
    stroke,
    width,
  );
}
