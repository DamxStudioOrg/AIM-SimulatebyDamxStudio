"use client";

import { useRouter } from "next/navigation";
import { buildConsoleLink, buildToteLink } from "@/lib/console-link";
import { readBotNickname } from "@/lib/auth";
import type { Challenge } from "@/lib/challenges";
import type { Ghost } from "@/lib/leagues";
import LeaguesPanel from "../leagues-panel";
import PageHeader from "../page-header";
import ProgressBoard from "../progress-board";
import RanksPanel from "../ranks-panel";
import RouteShell from "../route-shell";
import { useAuth } from "../auth-context";
import { useCompletions } from "../use-completions";
import { useHistory } from "../use-history";
import { useMoonTitle, useMoonVisual } from "../moon-visual";
import { useEffect } from "react";

/** Device leaderboard, personal progress, and friend leagues — on-device only. */
export default function RanksPage(): React.ReactElement {
  // Left panel while signed out: the gate clears the board, so the
  // title stands in. Signed in, the board always wins.
  useMoonTitle("Ranks & leagues");
  const auth = useAuth();
  const historyApi = useHistory();
  const router = useRouter();
  const { completions } = useCompletions();
  const { setStage } = useMoonVisual();
  const runCount = historyApi.history.length;
  // Cleared-trials board lives in the left stage slot while signed
  // in; the gate clears it.
  useEffect(() => {
    if (!auth.signedIn) {
      setStage(null);
      return () => {
        setStage(null);
      };
    }
    setStage(<ProgressBoard completions={completions} runCount={runCount} />);
    return () => {
      setStage(null);
    };
  }, [setStage, auth.signedIn, completions, runCount]);

  function playGhost(ghost: Ghost): void {
    if (ghost.game === "tote") {
      router.push(
        buildToteLink({ prompt: ghost.prompt ?? "", seed: String(ghost.seed) }),
      );
      return;
    }
    router.push(
      buildConsoleLink({
        challenge: ghost.challenge ?? "",
        prompt: ghost.prompt ?? "",
        seed: String(ghost.seed),
      }),
    );
  }

  function playRotation(challenge: Challenge): void {
    router.push(buildConsoleLink({ challenge: challenge.id }));
  }

  return (
    <RouteShell
      gateHeadingId="ranks-signin-heading"
      gateTitle="Sign in to run"
      gateHint="Sign in to open the ranks. Sessions stay on this machine."
    >
      <PageHeader words={["Ranks", "& leagues"]} />
      <RanksPanel />
      <LeaguesPanel
        uid={auth.uid}
        nickname={readBotNickname()}
        history={historyApi.history}
        onPlayGhost={playGhost}
        onPlayRotation={playRotation}
      />
    </RouteShell>
  );
}
