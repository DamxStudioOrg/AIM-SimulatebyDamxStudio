import type { EnvironmentReport } from "../lib/sim";

const SITE_LABELS: Record<string, string> = {
  quarry: "Quarry",
  aquifer: "Aquifer",
  vent: "Vent Ridge",
};

const WEATHER_LABELS: Record<string, string> = {
  rain: "Rain",
  seismic: "Seismic",
  heat: "Heat",
};

export function EnvironmentPanel({ environment }: { environment: EnvironmentReport }) {
  const restoration = environment.restoration;
  const bias = environment.stewardship_bias;
  return (
    <>
      <h3>Land &amp; sites</h3>
      <p className="match-meta">
        Prioritization {environment.prioritization.toFixed(0)}/100 · Stewardship bias{" "}
        {bias >= 0 ? "+" : ""}
        {bias.toFixed(0)} · Restoration:{" "}
        {WEATHER_LABELS[restoration.weather] ?? restoration.weather} (turns{" "}
        {restoration.turns[0]}–{restoration.turns[restoration.turns.length - 1]})
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col" className="num">
              Health
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(environment.site_health).map(([site, health]) => (
            <tr key={site}>
              <th scope="row">{SITE_LABELS[site] ?? site}</th>
              <td className="num">{health.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Terrain at the whistle: {environment.features.rock ?? 0} rocks ·{" "}
        {environment.features.vent ?? 0} vents · {environment.features.flora ?? 0} flora
        across 51 cells. Moisture {(environment.summary.moisture ?? 0).toFixed(0)} ·
        erosion {(environment.summary.erosion ?? 0).toFixed(0)} · heat{" "}
        {(environment.summary.heat ?? 0).toFixed(0)}.
      </p>
    </>
  );
}
