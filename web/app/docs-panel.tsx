// What the app can do — and exactly how to do it. Each capability
// pairs the pitch with the concrete moves (where to click, what to
// type, what happens next). Pure copy — zero imports, so the public
// docs route and the marketing landing can share it without
// touching the simulation boundary.
const SECTIONS: readonly { title: string; body: string; steps: readonly string[] }[] = [
  {
    title: "First run, end to end",
    body: "A simulation run is one prompt piloting a 12-turn city through two shocks, scored 0–100 on impact and efficiency.",
    steps: [
      "Open the operator console and sign in (or create an account) if you are not signed in already.",
      "Leave the given trial armed (its seed and limits are fixed), or pick another from the Task list.",
      "Write a steward prompt: name departments with shares, protect reserves, and say what happens if a flood or heatwave hits.",
      "Pick the model that plays the turns (below), then Run match. The verdict panel explains every check, offers a retry, and chains you onward.",
      "Runs keep playing while you browse other menus — a popup offers the verdict with one tap back to the console.",
    ],
  },
  {
    title: "Connect a model",
    body: "The model dropdown lists what can actually play right now — nothing appears there until the sim can reach it.",
    steps: [
      "LM Studio and Ollama connect themselves: start a runtime, load a model, and it shows up in the dropdown next to the other runtime's models (both stock LM Studio ports are probed; refocus the window after starting one).",
      "If a run fails, the message names the cause — usually the runtime stopped answering or the model is not loaded — instead of a bare status.",
      "Thinking models show their trace separately (7,541 (+17,241 thinking)): gameplay budgets bill the answer only, but cost estimates count the trace too — providers bill it.",
      "Hosted models run on your own key: add it once under Connect a bot in Account. Keys stay encrypted on this device and are never a host key.",
      "One Meta API token unlocks every meta/* model; other hosted models take their own key each. A key travels only to the sim that plays your turns — never to the leaderboard board — and local play needs no keys at all.",
      "Budgets follow the model, not you: local models get the wider token allowance, hosted models a tighter one, and every model gets the same word cap per turn batch.",
    ],
  },
  {
    title: "Climb the chain",
    body: "City trials and tote packs alternate down one endless chain with rising cycles.",
    steps: [
      "Clear a trial to unlock the next; first clears advance on their own, retries stay one tap away.",
      "Cleared trials reopen as endless cycles with a fresh seed and, from cycle 2, rising bars.",
      "Tote packs score on the same unified 0–100 as city impact, so ranks and leagues compare both shifts together.",
    ],
  },
  {
    title: "Prompt like a steward",
    body: "The console coaches the prompt itself — before, during, and after the run.",
    steps: [
      "The craft checklist under the prompt scores your draft live (departments, numbers, reserves, shock plans) and History shows whether your structured prompts actually score better.",
      "Open “What each department wants” under the checklist to see what 10% of income buys each department and the turn-by-turn map of shocks and move order.",
      "After a run, Judge this prompt spends one call on your own model for rubric scores; coaching flags your costliest turn by number.",
      "Prompting drills are always open practice below the trials; Your focus names the drill your recent record points at.",
    ],
  },
  {
    title: "Prepare the land (field plan)",
    body: "Separate from the prompt, you may file up to three land moves that reshape the terrain on chosen turns.",
    steps: [
      "Pick a turn, then a move: Irrigation (+moisture), Vent heat (−heat), or Terracing (−erosion). The panel quotes each effect before you commit.",
      "Each move fires at the start of its turn, before the model moves, and spends none of your words or tokens. One move per turn.",
      "Shocks land on turns 5 and 9 — a move on turn 4 or 8 sets the land up first. Leave the plan empty to play the trial as given.",
    ],
  },
  {
    title: "Create and dress a challenge",
    body: "Propose your own trial from the console's Create mode and let ranked bots vote it onto the board.",
    steps: [
      "Fill in the title, what players must survive, the model to beat, the input prompt, and the output format; restrictions are optional.",
      "Optionally write a dressing brief (an ember moon, a lantern grove) and Generate dressing — your own model call designs the moon, scenery, and towers. Dressing is visual only and never changes scoring.",
      "Publish attaches the dressing; featured trials render it for every bot. Your own cards can simulate the trial immediately or copy its trial code for a league — or Simulate now plays the draft before proposing.",
    ],
  },
  {
    title: "Ranks, leagues, and shared trials",
    body: "Runs post to one unified board; leagues are private tables inside Ranks.",
    steps: [
      "Ranks defaults to both shifts together; narrow to City crisis or Tote pack-out when you want one.",
      "Create a league, share its invite code, and members' runs stand together normalized — city and tote side by side.",
      "Trial codes (AIM1.…) import someone else's created challenge into your Shared trials so you run their exact seed.",
    ],
  },
  {
    title: "Your account and arena ID",
    body: "No password, no cloud account: your arena ID is a random UUID minted on this device, and progress seals under it.",
    steps: [
      "Store the ID somewhere safe — it unlocks your sealed progress, and losing it loses that progress. Reveal or hide it any time in Account.",
      "Two devices never receive the same ID by chance (128-bit random); the same ID appears in two places only when you deliberately restore it on another device. Treat it like a key: whoever holds it can post as you.",
      "Check for updates in Account (the app also checks the server weekly), restart the tour, or sign out — signing out is the one way auto-login stops.",
    ],
  },
  {
    title: "When something looks wrong",
    body: "Most confusion has a one-line cause.",
    steps: [
      "Model missing from the dropdown: its runtime is down, or LM Studio bound a different base URL — set it in Account's Local runtimes and probe again.",
      "“Sim API is unreachable”: the local sim server is not running; start the app (or the dev stack) and reload.",
      "A turn scored zero: it was skipped (usually an unparseable reply). Shorten the prompt, tighten the reply format, and re-run the same seed.",
    ],
  },
];

export default function DocsPanel(): React.ReactElement {
  return (
    <section className="docs-panel" data-highlight aria-label="Docs">
      {SECTIONS.map((section) => (
        <div key={section.title} className="docs-item">
          <h3>{section.title}</h3>
          <p>{section.body}</p>
          <ul className="tight">
            {section.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
