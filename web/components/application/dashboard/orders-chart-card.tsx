"use client";

import { useId, useState } from "react";
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import { Chip } from "@/components/base/badges/chip";
import {
  ChartShapeToggle,
  type ChartShape,
} from "@/components/application/dashboard/chart-shape-toggle";
import { useCountUp } from "@/hooks/use-count-up";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cx } from "@/utils/cx";

/**
 * Orders Chart Card: a year of monthly orders as bars, this year beside last
 * year for every month, so the comparison is read bar to bar rather than
 * against a line. The header is the same as the revenue chart's: a count-up
 * total with a delta chip, the year-earlier figure under it, and a legend.
 * Hovering a month swaps the headline for that month.
 *
 * The demo copy (orders, years) is only the default: `data` takes any
 * labelled series, and the format/label/caption props retitle the card
 * for domain series such as per-turn tokens (see lib/run-charts.ts).
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface OrdersPoint {
  /** Short month label on the axis. */
  label: string;
  /** Orders this year. */
  current: number;
  /** Orders in the same month a year earlier. */
  previous: number;
}

/** Twelve months that add up to the stat cards' total orders. */
export const ORDERS_DATA: OrdersPoint[] = [
  { label: "Jan", current: 1680, previous: 1510 },
  { label: "Feb", current: 1740, previous: 1480 },
  { label: "Mar", current: 1920, previous: 1650 },
  { label: "Apr", current: 1850, previous: 1620 },
  { label: "May", current: 2040, previous: 1710 },
  { label: "Jun", current: 2110, previous: 1760 },
  { label: "Jul", current: 2290, previous: 1840 },
  { label: "Aug", current: 2180, previous: 1890 },
  { label: "Sep", current: 2320, previous: 1930 },
  { label: "Oct", current: 2410, previous: 1970 },
  { label: "Nov", current: 2280, previous: 1810 },
  { label: "Dec", current: 2342, previous: 1798 },
];

const formatK = (value: number) =>
  value >= 1000
    ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
    : String(value);

function describeDelta(current: number, previous: number) {
  if (previous === 0) return { label: "New", color: "neutral" as const };
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return { label: "0%", color: "neutral" as const };
  return {
    label: `${rounded > 0 ? "+" : ""}${String(rounded)}%`,
    color: rounded > 0 ? ("lime" as const) : ("rose" as const),
  };
}

/** The active point's marker on the current-series line (area shape). */
function ActiveDot({ cx: x, cy: y }: { cx?: number; cy?: number }) {
  if (x === undefined || y === undefined) return null;
  return (
    <g>
      <circle cx={x} cy={y} r={7} fill="var(--color-chart-9-active)" opacity={0.25} />
      <circle
        cx={x}
        cy={y}
        r={4}
        fill="var(--color-chart-9-active)"
        stroke="var(--color-background-secondary-default)"
        strokeWidth={2}
      />
    </g>
  );
}

export function OrdersChartCard({
  data = ORDERS_DATA,
  title = "Orders",
  className,
  formatValue = (value: number): string => value.toLocaleString("en-US"),
  formatAxis = formatK,
  currentLabel = "This year",
  previousLabel = "Last year",
  totalCaption = "last year",
  pointCaption = "a year earlier",
}: {
  /** Twelve points, one per month; defaults to the demo year. */
  data?: OrdersPoint[];
  /** Headline label when no month is hovered. */
  title?: string;
  className?: string;
  /** Headline and comparison figure formatting. */
  formatValue?: (value: number) => string;
  /** Y-axis tick formatting. */
  formatAxis?: (value: number) => string;
  /** Legend entries for the current and previous series. */
  currentLabel?: string;
  previousLabel?: string;
  /** Caption under the comparison figure: totals vs hovered point. */
  totalCaption?: string;
  pointCaption?: string;
} = {}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [shape, setShape] = useState<ChartShape>("bars");
  const reducedMotion = usePrefersReducedMotion();
  const gradientId = useId();

  const totalCurrent = data.reduce((sum, point) => sum + point.current, 0);
  const totalPrevious = data.reduce((sum, point) => sum + point.previous, 0);
  const hovering = activeIndex !== null && activeIndex < data.length;
  const point = hovering ? data[activeIndex] : null;

  const headlineValue = point ? point.current : totalCurrent;
  const comparison = point ? point.previous : totalPrevious;
  const delta = describeDelta(headlineValue, comparison);
  const monthIndex = point ? MONTHS.indexOf(point.label) : -1;
  const label = point
    ? monthIndex >= 0
      ? MONTHS_FULL[monthIndex]
      : point.label
    : title;
  const display = useCountUp(headlineValue);

  // Bar glyphs dim every point except the hovered one; the shape
  // render prop replaces the deprecated Cell children (recharts 3).
  const dimShape = (shapeProps: BarShapeProps): React.ReactElement => (
    <Rectangle
      x={shapeProps.x}
      y={shapeProps.y}
      width={shapeProps.width}
      height={shapeProps.height}
      radius={shapeProps.radius}
      fill={shapeProps.fill}
      fillOpacity={activeIndex === null || activeIndex === shapeProps.index ? 1 : 0.35}
    />
  );

  if (data.length === 0) {
    return null;
  }
  const yMax = Math.max(...data.map((d) => Math.max(d.current, d.previous)));

  return (
    <section
      className={cx(
        "flex h-[344px] min-w-0 flex-1 flex-col gap-6 rounded-2xl bg-background-secondary-default px-4 pt-4 pb-3",
        className,
      )}
    >
      {/* Header: label over the count-up figure and its delta; legend on the right */}
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="w-full text-body-medium text-text-secondary">{label}</p>
          <div className="flex w-full items-center gap-2">
            <p
              key={activeIndex ?? "total"}
              className="animate-number-fade text-title-1-medium whitespace-nowrap text-text-primary tabular-nums"
            >
              {formatValue(display)}
            </p>
            <Chip variant="bold" color={delta.color}>
              {delta.label}
            </Chip>
          </div>
          <p className="text-body-2-medium text-text-tertiary tabular-nums">
            {formatValue(comparison)} {point ? pointCaption : totalCaption}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <dl className="flex items-center gap-4 text-body-2-medium text-text-secondary">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-9-active" aria-hidden />
              <dt>{currentLabel}</dt>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-neutral" aria-hidden />
              <dt>{previousLabel}</dt>
            </div>
          </dl>
          <ChartShapeToggle shape={shape} onChange={setShape} />
        </div>
      </div>

      {/* Chart: ComposedChart renders bars identically to BarChart and
          also hosts the area shape; keyed by shape so switching
          remounts the glyphs — the bars/area morph. */}
      <div key={shape} data-shape={shape} className="morph-chart min-h-0 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
            barCategoryGap="28%"
            barGap={3}
            onMouseMove={(state) => {
              const index = Number(state.activeTooltipIndex);
              if (state.isTooltipActive && Number.isFinite(index))
                setActiveIndex(index);
            }}
            onMouseLeave={() => {
              setActiveIndex(null);
            }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-9)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-chart-9)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis
              width={40}
              domain={[0, yMax * 1.1]}
              tickCount={4}
              tickFormatter={formatAxis}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              interval="preserveStartEnd"
              tick={{ fontSize: 13, fill: "var(--color-text-tertiary)" }}
            />
            <Tooltip
              content={() => null}
              cursor={
                shape === "bars"
                  ? { fill: "var(--color-chart-track)", opacity: 0.5 }
                  : {
                      stroke: "var(--color-chart-cursor)",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }
              }
            />
            {shape === "bars" ? (
              <>
                <Bar
                  dataKey="previous"
                  fill="var(--color-chart-neutral)"
                  radius={[4, 4, 0, 0]}
                  shape={dimShape}
                  isAnimationActive={!reducedMotion}
                  animationDuration={450}
                />
                <Bar
                  dataKey="current"
                  fill="var(--color-chart-9-active)"
                  radius={[4, 4, 0, 0]}
                  shape={dimShape}
                  isAnimationActive={!reducedMotion}
                  animationDuration={450}
                />
              </>
            ) : (
              <>
                <Line
                  type="monotone"
                  dataKey="previous"
                  stroke="var(--color-chart-neutral)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={!reducedMotion}
                  animationDuration={450}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  stroke="none"
                  fill={`url(#${gradientId})`}
                  isAnimationActive={!reducedMotion}
                  animationDuration={450}
                />
                <Line
                  type="monotone"
                  dataKey="current"
                  stroke="var(--color-chart-9-active)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={<ActiveDot />}
                  isAnimationActive={!reducedMotion}
                  animationDuration={450}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
