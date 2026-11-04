"use client";

import CostChip from "./cost-chip";
import RunButton from "./run-button";
import { useOnline } from "./use-online";
import { useSimRoute } from "./use-sim-route";
import { formatHistoryWhen } from "@/lib/history";
import { formatTokensWithThinking, trueTokenTotal } from "@/lib/pricing";
import { badgeLabels } from "@/lib/server-board";
import { kindLabel } from "./use-match";
import type { ToteApi } from "./use-tote";
import { challengePassed, evaluateToteChallenge } from "@/lib/challenges";
import type { Challenge } from "@/lib/challenges";

/**
 * Tote pack form: the submit half of the console's one play
 * section. Bare by design — the console owns the section and the
 * shared task picker; the live task drives the seed lock and the
 * trial card.
 */
export function ToteSubmit({
  tote,
  focusField,
  onFocused,
  challenge,
}: Readonly<{
  tote: ToteApi;
  focusField: string | null;
  onFocused: () => void;
  challenge?: Challenge;
}>): React.ReactElement {
  const {
    contract,
    contractError,
    catalog,
    offer,
    offerError,
    prompt,
    setPrompt,
    seedText,
    setSeedText,
    model,
    setModel,
    running,
    startedAt,
    error,
    words,
    cap,
    overCap,
    seedValid,
    canRun,
    packTote,
  } = tote;

  const byId = new Map((catalog?.items ?? []).map((item) => [item.id, item]));
  const online = useOnline();
  const { route: simRoute, endpoint: simEndpoint } = useSimRoute();

  return (
    <>
      <p className="lede">
        Between city crises, the market crew runs a packing simulation. The crane loads
        the levitating tote — your prompt calls the stacking order, bottom item first.
        Pack it clean and take the board.
      </p>
      {challenge !== undefined && (
        <div className="challenge-card">
          <h3>{challenge.title}</h3>
          <p>{challenge.brief}</p>
          <ol className="story-beats" aria-label="Trial story">
            {challenge.story.map((beat) => (
              <li key={beat}>{beat}</li>
            ))}
          </ol>
          <p className="hint">{challenge.tip}</p>
        </div>
      )}
      {contractError !== null ? (
        <p className="error" role="alert">
          {contractError}
        </p>
      ) : (
        <p className="hint">
          {contract === null
            ? "Contacting sim API…"
            : `Sim ${contract.sim_version} · bag holds ${catalog?.capacity_kg.toFixed(0) ?? "…"} kg · cap ${String(contract.prompt_max_words)} words`}
        </p>
      )}
      <div className="offer-slot">
        {offerError !== null && (
          <p className="error" role="alert">
            {offerError}
          </p>
        )}
        {offer !== null && (
          <>
            <h3>On offer this seed</h3>
            <ul className="tight">
              {offer.offered.map((id) => {
                const item = byId.get(id);
                const scarce = offer.scarce.includes(id);
                return (
                  <li key={id}>
                    {item?.label ?? id}
                    {item !== undefined &&
                      ` — ${item.weight.toFixed(1)} kg · worth ${item.value.toFixed(0)}${item.fragile ? " · fragile" : ""}${item.tags.length > 0 ? ` · ${item.tags.join(", ")}` : ""}${scarce ? " · scarce" : ""}`}
                  </li>
                );
              })}
            </ul>
            <p className="hint">
              House rules: heavies at the bottom, liquids low and away from fabric,
              fragile on top, rope above the saw. Scarce tools earn a bonus when packed,
              and up to 2 non-offered catalog tools may ride as free slots.
            </p>
          </>
        )}
      </div>
      <label htmlFor="tote-prompt">Packing prompt for the agent</label>
      <textarea
        id="tote-prompt"
        ref={(node) => {
          if (node !== null && focusField === "tote-prompt") {
            node.focus();
            onFocused();
          }
        }}
        rows={8}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
        }}
        placeholder="Pack the heaviest tools at the bottom, keep liquids away from fabric, fragile things on top…"
      />
      <p className={overCap ? "hint over" : "hint"}>
        {words} / {cap} words
        {overCap ? " — over cap, trimmed by nothing; fix it" : ""}
      </p>
      <label htmlFor="tote-seed">Seed (same seed offers the same tools)</label>
      <input
        id="tote-seed"
        type="number"
        value={seedText}
        disabled={challenge !== undefined}
        onChange={(event) => {
          setSeedText(event.target.value);
        }}
      />
      {challenge !== undefined && (
        <p className="hint">Seed fixed by the {challenge.title} task.</p>
      )}
      {!seedValid && <p className="hint over">Seed must be an integer.</p>}
      <label htmlFor="tote-model">Model (who packs)</label>
      <select
        id="tote-model"
        value={model}
        disabled={contract === null || contract.models.length === 0}
        onChange={(event) => {
          setModel(event.target.value);
        }}
      >
        {(contract?.models ?? []).map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.id} — {kindLabel(entry.kind)}
          </option>
        ))}
      </select>
      {!online && (
        <p className="hint" role="status">
          You&apos;re offline — reconnect to pack a tote.
        </p>
      )}
      {online && simRoute === "direct" && (
        <p className="hint" role="status">
          Local mode — running via {simEndpoint}.
        </p>
      )}
      <RunButton
        running={running}
        startedAt={startedAt}
        idleLabel="Pack tote"
        busyLabel="Packing"
        disabled={!canRun || !online}
        onRun={() => {
          void packTote();
        }}
      />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Tote pack result: the verdict half. The verdict binds to the
 * packed task snapshot, not the live picker — auto-advance moves
 * the form on while the verdict stands.
 */
export function ToteResult({
  tote,
  verdictChallenge,
}: Readonly<{
  tote: ToteApi;
  verdictChallenge?: Challenge;
}>): React.ReactElement | null {
  const { result, model, replayWhen, boardPosition } = tote;
  const byId = new Map((tote.catalog?.items ?? []).map((item) => [item.id, item]));
  if (result === null) {
    return null;
  }
  const challenge = verdictChallenge;
  return (
    <section
      className="result"
      aria-labelledby="tote-result-heading"
      data-visual="pack"
    >
      <h2 id="tote-result-heading">Result</h2>
      <p className="section-sub">What the pack scored.</p>
      <p className="match-meta">
        Seed {result.seed} · {result.provider} ·{" "}
        {formatTokensWithThinking(
          result.totals.tokens_used,
          result.totals.thinking_tokens ?? 0,
        )}{" "}
        tokens
        <CostChip
          tokens={trueTokenTotal(
            result.totals.tokens_used,
            result.totals.thinking_tokens ?? 0,
          )}
          model={model}
        />
        {boardPosition !== null && (
          <>
            {" "}
            · <a href="/ranks">live board #{boardPosition}</a>
          </>
        )}
        {replayWhen !== null && <> · replay of {formatHistoryWhen(replayWhen)}</>}
      </p>
      {result.usage_anomaly && (
        <p className="error" role="alert">
          Usage check flagged this pack: reported tokens diverged from the estimate, so
          its budget accounting is suspect.
        </p>
      )}
      {result.badges.length > 0 && (
        <p className="badges" role="status">
          Badges{" "}
          {badgeLabels(result.badges).map((label) => (
            <span key={label} className="pill">
              {label}
            </span>
          ))}
        </p>
      )}
      {challenge !== undefined &&
        result.invalid_reason === null &&
        (() => {
          const checks = evaluateToteChallenge(challenge, result);
          if (checks.length === 0) {
            return null;
          }
          const passed = challengePassed(checks);
          return (
            <div className={passed ? "verdict verdict-pass" : "verdict"} role="status">
              <h3>
                {passed ? "Challenge cleared" : "Challenge missed"} — {challenge.title}
              </h3>
              <ul className="tight">
                {checks.map((check) => (
                  <li key={check.label} className={check.passed ? "pass" : "miss"}>
                    {check.passed ? "✓" : "✗"} {check.label} — now {check.actual}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      {result.invalid_reason !== null ? (
        <p className="error" role="alert">
          No valid packing: {result.invalid_reason}. The model must answer
          {' {"packing": [bottom … top]} '} using offered tools plus up to 2 free-slot
          picks.
        </p>
      ) : (
        <>
          <h3>Packing, bottom to top</h3>
          <ol className="tight">
            {result.packing.map((id) => (
              <li key={id}>
                {byId.get(id)?.label ?? id}
                {result.wildcards.includes(id) ? " — free slot" : ""}
                {result.scarce.includes(id) ? " · scarce" : ""}
              </li>
            ))}
          </ol>
          <h3>Score breakdown</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col" className="num">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Packed value</th>
                <td className="num">{result.value.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Overweight strain</th>
                <td className="num">−{result.damage.overweight.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Crush load</th>
                <td className="num">−{result.damage.crush.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Stains</th>
                <td className="num">−{result.damage.stain.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Cuts</th>
                <td className="num">−{result.damage.cut.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Badge + scarce bonus</th>
                <td className="num">+{result.bonus.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Score</th>
                <td className="num">{result.score.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
