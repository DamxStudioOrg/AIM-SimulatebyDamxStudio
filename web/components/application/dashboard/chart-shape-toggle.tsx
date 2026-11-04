"use client";

/** Chart glyph shape: filled area against a compare line, or side-by-side bars. */
export type ChartShape = "area" | "bars";

/**
 * Segmented Area|Bars control for the dashboard chart cards. Switching
 * shapes remounts the glyphs so recharts plays its enter animation —
 * the morph between area and bars — while the headline, legend, and
 * hovered point stay put.
 */
export function ChartShapeToggle({
  shape,
  onChange,
  label = "Chart shape",
}: {
  shape: ChartShape;
  onChange: (shape: ChartShape) => void;
  label?: string;
}): React.ReactElement {
  return (
    <div className="chart-shape-toggle" role="group" aria-label={label}>
      {(["area", "bars"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={shape === option}
          className={shape === option ? "shape-active" : undefined}
          onClick={() => {
            onChange(option);
          }}
        >
          {option === "area" ? "Area" : "Bars"}
        </button>
      ))}
    </div>
  );
}
