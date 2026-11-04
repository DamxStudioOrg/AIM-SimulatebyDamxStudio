import { NextResponse } from "next/server";
import {
  DEFAULT_OLLAMA,
  loopbackBase,
  probeLmStudio,
  probeModels,
} from "@/lib/local-models";

/**
 * Local-model discovery: lists what LM Studio and Ollama expose on
 * this machine through the OpenAI `/v1/models` standard. With no
 * `?lmstudio=` base, LM Studio is probed across its conventional
 * ports (1234, then the 1235 fallback) so a port-shifted instance
 * connects without typing a URL. Bases must be loopback.
 */
/** Live runtime probe: models appear as daemons start. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const requested = params.get("lmstudio");
  const lmstudio = requested === null ? null : loopbackBase(requested);
  const ollama = loopbackBase(params.get("ollama") ?? DEFAULT_OLLAMA);
  if ((requested !== null && lmstudio === null) || ollama === null) {
    return NextResponse.json(
      { error: "bases must be http(s) loopback URLs" },
      { status: 400 },
    );
  }
  const sources = await Promise.all([
    lmstudio === null ? probeLmStudio() : probeModels("LM Studio", lmstudio),
    probeModels("Ollama", ollama),
  ]);
  return NextResponse.json({ sources });
}
