/**
 * Console deep-links: routes without the run form (leagues ghosts,
 * prompt history, challenge lists) send the reader to the console
 * with the run pre-loaded. Params are advisory — the console
 * validates the challenge id and caps the prompt like a paste.
 */

export interface ConsoleLinkParams {
  challenge?: string;
  prompt?: string;
  seed?: string;
  /** Pack links say tote; the console routes prompt/seed to the tote form. */
  game?: string;
}

const MAX_PROMPT_CHARS = 4000;

/** /console?challenge=&prompt=&seed= with blanks dropped. */
export function buildConsoleLink(params: ConsoleLinkParams): string {
  const search = new URLSearchParams();
  if (params.challenge !== undefined && params.challenge !== "") {
    search.set("challenge", params.challenge);
  }
  if (params.prompt !== undefined && params.prompt !== "") {
    search.set("prompt", params.prompt.slice(0, MAX_PROMPT_CHARS));
  }
  if (params.seed !== undefined && params.seed !== "") {
    search.set("seed", params.seed);
  }
  const query = search.toString();
  return query === "" ? "/console" : `/console?${query}`;
}

/** /console?game=tote&prompt=&seed= with blanks dropped. */
export function buildToteLink(params: ConsoleLinkParams): string {
  const search = new URLSearchParams();
  search.set("game", "tote");
  if (params.prompt !== undefined && params.prompt !== "") {
    search.set("prompt", params.prompt.slice(0, MAX_PROMPT_CHARS));
  }
  if (params.seed !== undefined && params.seed !== "") {
    search.set("seed", params.seed);
  }
  return `/console?${search.toString()}`;
}

/** Parse the advisory params back out; blanks read as undefined. */
export function parsePlayParams(search: string): ConsoleLinkParams {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const challenge = params.get("challenge") ?? "";
  const prompt = params.get("prompt") ?? "";
  const seed = params.get("seed") ?? "";
  const game = params.get("game") ?? "";
  return {
    ...(challenge === "" ? {} : { challenge }),
    ...(prompt === "" ? {} : { prompt }),
    ...(seed === "" ? {} : { seed }),
    ...(game === "" ? {} : { game }),
  };
}
