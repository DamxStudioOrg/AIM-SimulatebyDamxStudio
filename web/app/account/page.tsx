"use client";

import AccountPanel from "../account-panel";
import ApiKeysCard from "../api-keys-card";
import AppUpdateCard from "../app-update-card";
import LocalRuntimesCard from "../local-runtimes-card";
import { Button } from "@/components/base/buttons/button";
import { startTour } from "@/lib/tour";
import LocalSimCard from "../local-sim-card";
import { useMoonTitle } from "../moon-visual";
import PageHeader from "../page-header";
import RouteShell from "../route-shell";
import { useContractModels } from "../use-contract-models";
import { useHistory } from "../use-history";
import { useState } from "react";

/** Identity, recovery, transfer, sign-out, and model connections. */
export default function AccountPage(): React.ReactElement {
  // Account publishes no stage, so the title owns the left panel.
  useMoonTitle("Your account");
  const models = useContractModels();
  const historyApi = useHistory();
  const [cleared, setCleared] = useState(false);
  return (
    <RouteShell
      gateHeadingId="account-signin-heading"
      gateTitle="Sign in to run"
      gateHint="Sign in to open your account. Sessions stay on this machine."
    >
      <PageHeader words={["Your", "account"]} />
      <section aria-labelledby="tour-heading">
        <h2 id="tour-heading">Tour</h2>
        <p>
          New here, or want the route again? The tour walks every page — console,
          prompts, ranks, account, docs — a few stops each.
        </p>
        <p className="cta-row">
          <Button
            variant="primary"
            onClick={() => {
              startTour();
            }}
          >
            Start the tour
          </Button>
        </p>
      </section>
      <AccountPanel />
      <section aria-labelledby="connect-models-heading">
        <h2 id="connect-models-heading">Connect models</h2>
        <p>
          Bots are prompts only. Pick a seed, write a prompt, run the match. The city
          replays each round.
        </p>
        <p className="hint">
          Local models need their runtime running (Ollama with a pulled model, or an
          OpenAI-compatible server). Hosted models run on your key, encrypted on this
          device — never on a host key. Your prompt and the city state still travel to
          the provider with each turn.
        </p>
      </section>
      <LocalRuntimesCard />
      <ApiKeysCard models={models} />
      <LocalSimCard />
      <AppUpdateCard />
      <section aria-labelledby="reset-data-heading">
        <h2 id="reset-data-heading">Reset data</h2>
        <p>
          Clears run history, cleared trials, and best scores on this device. Your arena
          ID, leagues, imported trials, and shared board rows stay — the board is
          append-only.
        </p>
        <p className="cta-row">
          <Button
            variant="danger"
            onClick={() => {
              historyApi.clearHistory();
              setCleared(true);
            }}
          >
            Clear history and trials
          </Button>
        </p>
        {cleared && (
          <p className="hint" role="status">
            Cleared. The console, ranks, and prompts pages read the empty store on their
            next visit.
          </p>
        )}
      </section>
    </RouteShell>
  );
}
