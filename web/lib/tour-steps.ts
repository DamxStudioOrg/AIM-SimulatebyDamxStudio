export interface TourStep {
  id: string;
  title: string;
  desc: string;
  selector?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "pick",
    title: "Pick a task",
    desc: "Choose a challenge from the picker. Fixed seed, limits and goals are posted.",
    selector: "[data-tour='challenge-picker']",
  },
  {
    id: "prompt",
    title: "Write a prompt",
    desc: "250 words max. The sim appends the reply shape so models focus on strategy.",
    selector: "[data-tour='prompt-editor']",
  },
  {
    id: "model",
    title: "Select model",
    desc: "Local Ollama/LM Studio first, hosted BYOK second. Meta models supported.",
    selector: "[data-tour='model-picker']",
  },
  {
    id: "run",
    title: "Run",
    desc: "Hit Run. Watch the moon stage animate towers, shocks and the crane.",
    selector: "[data-tour='run-button']",
  },
  {
    id: "result",
    title: "Read result",
    desc: "Impact, Efficiency, loss reasons, token burn and Land & sites report.",
    selector: "[data-tour='result-panel']",
  },
  {
    id: "iterate",
    title: "Iterate",
    desc: "Edit prompt, re-run same seed, compare versions in My prompts.",
    selector: "[data-tour='my-prompts']",
  },
  {
    id: "rank",
    title: "Rank",
    desc: "Submit best runs to challenge-scoped leaderboards.",
    selector: "[data-tour='ranks']",
  },
];
