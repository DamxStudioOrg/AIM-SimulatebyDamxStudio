"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import type { RefObject } from "react";
import gsap from "gsap";
import { useOnline } from "./use-online";
import type { ChallengeAssets } from "@/lib/asset-schema";
import { parseChallengeAssets, summarizeAssets } from "@/lib/asset-schema";
import type { CommunityProposal } from "@/lib/community";
import {
  draftAssets,
  fetchProposals,
  latestReceiptForUid,
  proposeProposal,
  voteProposal,
} from "@/lib/community";
import type { Challenge } from "@/lib/challenges";
import {
  encodeShareCode,
  localTrialChallenge,
  rotationChallenge,
  snapshotFromProposal,
} from "@/lib/leagues";
import type { HistoryEntry } from "@/lib/history";
import { displayBotName } from "@/lib/server-board";
import {
  CREATOR_DRAFT_KEY,
  parseCreatorDraft,
  serializeCreatorDraft,
} from "@/lib/creator-draft";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";
import type { ModelInfo } from "@/lib/sim";
import { META_PROVIDER_ID, loadProviderKey, tokenKeyForModel } from "@/lib/vault";

const TITLE_MAX = 80;
const BLURB_MAX = 2000;
const MODEL_MAX = 64;
const FORMAT_MAX = 255;
const BRIEF_MAX = 2000;

/** One-tap dressing briefs: name a mood, the model paints it. */
const STARTER_BRIEFS: readonly { label: string; brief: string }[] = [
  {
    label: "Ember moon",
    brief:
      "An ember-orange moon, heavy with craters, over a lantern grove; slim towers, warm crane.",
  },
  {
    label: "Frost parade",
    brief:
      "A pale frost moon with a faint halo, pennants strung between snowy pines; wide, calm towers.",
  },
  {
    label: "Mushroom dusk",
    brief:
      "A dusky gold moon over glowing mushroom clusters and still clouds; low, wide towers.",
  },
  {
    label: "Beacon watch",
    brief:
      "A bright moon ringed by signal beacons, sparse clouds, tall slim towers standing watch.",
  },
];

function byline(proposal: CommunityProposal): string {
  return displayBotName({ nickname: proposal.nickname, uid: proposal.uid });
}

function voteLabel(proposal: CommunityProposal): string {
  const count = proposal.votes === 1 ? "1 vote" : `${String(proposal.votes)} votes`;
  const heavy =
    proposal.weighted_votes === 1
      ? "1 weighted vote"
      : `${String(proposal.weighted_votes)} weighted votes`;
  return `${count} · ${heavy}`;
}

/** Community Challenge Creator: propose, feature, and rank-weighted vote. */
export default function CreatorPanel({
  uid,
  nickname,
  models,
  history,
  onSimulateTrial,
}: Readonly<{
  uid: string;
  nickname: string | null;
  models: ModelInfo[];
  /** Local run history; votes attach the newest sim receipt for uid. */
  history?: HistoryEntry[];
  /** Play a proposal now (the console arms it as a rotation trial). */
  onSimulateTrial?: (challenge: Challenge) => void;
}>): React.ReactElement {
  const [proposals, setProposals] = useState<CommunityProposal[] | null>(null);
  const [boardDown, setBoardDown] = useState(false);
  const [voted, setVoted] = useState<ReadonlySet<number>>(new Set());
  const [voting, setVoting] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  // Autosaved draft: simulating, mode hops, and reloads unmount
  // this form, and must never eat an unproposed draft.
  const [savedDraft] = useState(() =>
    parseCreatorDraft(safeGetItem(CREATOR_DRAFT_KEY)),
  );
  const [title, setTitle] = useState(savedDraft?.title ?? "");
  const [description, setDescription] = useState(savedDraft?.description ?? "");
  const [model, setModel] = useState(savedDraft?.model ?? "");
  const [inputPrompt, setInputPrompt] = useState(savedDraft?.inputPrompt ?? "");
  const [outputFormat, setOutputFormat] = useState(savedDraft?.outputFormat ?? "");
  const [restrictions, setRestrictions] = useState(savedDraft?.restrictions ?? "");
  const [brief, setBrief] = useState(savedDraft?.brief ?? "");
  const [dressModel, setDressModel] = useState(savedDraft?.dressModel ?? "");
  const [dressing, setDressing] = useState<ChallengeAssets | null>(
    savedDraft?.dressing ?? null,
  );
  const [drafting, setDrafting] = useState(false);
  const [draftTokens, setDraftTokens] = useState<number | null>(null);

  useEffect(() => {
    // The dressing model defaults itself on mount, so it never
    // keeps a draft alive alone — only real writing does.
    const blank =
      title === "" &&
      description === "" &&
      model === "" &&
      inputPrompt === "" &&
      outputFormat === "" &&
      restrictions === "" &&
      brief === "" &&
      dressing === null;
    if (blank) {
      safeRemoveItem(CREATOR_DRAFT_KEY);
      return;
    }
    safeSetItem(
      CREATOR_DRAFT_KEY,
      serializeCreatorDraft({
        title,
        description,
        model,
        inputPrompt,
        outputFormat,
        restrictions,
        brief,
        dressModel,
        dressing,
      }),
    );
  }, [
    title,
    description,
    model,
    inputPrompt,
    outputFormat,
    restrictions,
    brief,
    dressModel,
    dressing,
  ]);
  const freshRef = useRef<HTMLElement | null>(null);
  const online = useOnline();

  const reload = useCallback((): void => {
    setBoardDown(false);
    void fetchProposals().then((list) => {
      if (list === null) {
        setBoardDown(true);
        return;
      }
      setProposals(list);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (online) {
      reload();
    }
  }, [online, reload]);

  useEffect(() => {
    if (dressModel === "" && models.length > 0) {
      setDressModel(models[0]?.id ?? "");
    }
  }, [dressModel, models]);

  useEffect(() => {
    const node = freshRef.current;
    if (node === null || freshId === null) {
      return;
    }
    node.scrollIntoView({ block: "nearest" });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const tween = gsap.fromTo(
      node,
      { scale: 0.96, opacity: 0.4 },
      { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.6)" },
    );
    return () => {
      tween.kill();
    };
  }, [freshId, proposals]);

  async function generate(): Promise<void> {
    const kind = models.find((entry) => entry.id === dressModel)?.kind;
    let providerKey: string | undefined;
    if (kind === "hosted") {
      // Provider-level lookup: one Meta token unlocks every meta/*
      // dressing model, like matches — never the per-model miss.
      const tokenKey = tokenKeyForModel(dressModel);
      try {
        providerKey = (await loadProviderKey(tokenKey)) ?? undefined;
      } catch {
        providerKey = undefined;
      }
      if (providerKey === undefined) {
        setError(
          tokenKey === META_PROVIDER_ID
            ? "Add your Meta API token under Connect a bot first."
            : `Add your own key for "${dressModel}" under Connect a bot first.`,
        );
        return;
      }
    }
    setDrafting(true);
    setError(null);
    setNotice(null);
    const result = await draftAssets({
      prompt: brief.trim(),
      model: dressModel,
      uid,
      ...(providerKey === undefined ? {} : { providerKey }),
    });
    setDrafting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDressing(result.value.params);
    setDraftTokens(result.value.tokens_used);
    setNotice(
      `Dressing drafted on your own call (${String(result.value.tokens_used)} tokens) — publish to attach it.`,
    );
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = await proposeProposal({
      uid,
      ...(nickname === null ? {} : { nickname }),
      title: title.trim(),
      description: description.trim(),
      model: model.trim(),
      input_prompt: inputPrompt.trim(),
      output_format: outputFormat.trim(),
      ...(restrictions.trim() === "" ? {} : { restrictions: restrictions.trim() }),
      ...(dressing === null ? {} : { assets: dressing }),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProposals((previous) => [result.value, ...(previous ?? [])]);
    setFreshId(result.value.id);
    setTitle("");
    setDescription("");
    setModel("");
    setInputPrompt("");
    setOutputFormat("");
    setRestrictions("");
    setBrief("");
    setDressing(null);
    setDraftTokens(null);
    setNotice(
      `Proposed “${result.value.title}” — votes from ranked bots decide if it features.`,
    );
  }

  /** Share a created challenge as an AIM1 trial code for leagues. */
  async function shareTrial(entry: CommunityProposal): Promise<void> {
    setError(null);
    const code = encodeShareCode({
      version: 1,
      kind: "trial",
      trial: snapshotFromProposal(entry),
    });
    try {
      await navigator.clipboard.writeText(code);
      setNotice(
        `Trial code for “${entry.title}” copied — rivals import it under Leagues to run your challenge.`,
      );
    } catch {
      setNotice("Copy failed — your trial code is in the box below.");
      setShareCode(code);
    }
  }

  async function vote(proposal: CommunityProposal): Promise<void> {
    setVoting(proposal.id);
    setError(null);
    setNotice(null);
    const proof = latestReceiptForUid(history ?? [], uid) ?? undefined;
    const result = await voteProposal(proposal.id, uid, proof);
    setVoting(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const receipt = result.value;
    setProposals((previous) =>
      (previous ?? []).map((entry) =>
        entry.id === proposal.id
          ? {
              ...entry,
              votes: entry.votes + 1,
              weighted_votes: entry.weighted_votes + receipt.weight,
            }
          : entry,
      ),
    );
    setVoted((previous) => new Set(previous).add(proposal.id));
    const extras = [
      receipt.badges > 0 ? `${String(receipt.badges)} badges` : null,
      receipt.top3 ? "top-3 rank" : null,
    ].filter((part) => part !== null);
    setNotice(
      `Vote counted at weight ${String(receipt.weight)} (base ${String(receipt.base)}${extras.length > 0 ? ` + ${extras.join(" + ")}` : ""}).`,
    );
  }

  const featured = (proposals ?? []).filter((entry) => entry.featured);
  const open = (proposals ?? []).filter((entry) => !entry.featured);

  return (
    <>
      <section aria-label="Proposal form">
        {notice !== null && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {shareCode !== null && (
          <textarea
            aria-label="Trial code"
            readOnly
            rows={3}
            value={shareCode}
            onFocus={(event) => {
              event.target.select();
            }}
          />
        )}
        <label htmlFor="proposal-title">Title</label>
        <input
          id="proposal-title"
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <label htmlFor="proposal-description">What should players survive?</label>
        <textarea
          id="proposal-description"
          rows={3}
          value={description}
          maxLength={BLURB_MAX}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <label htmlFor="proposal-model">AI model to beat</label>
        <input
          id="proposal-model"
          type="text"
          value={model}
          maxLength={MODEL_MAX}
          placeholder="Muse"
          onChange={(event) => {
            setModel(event.target.value);
          }}
        />
        <label htmlFor="proposal-input">Input prompt</label>
        <textarea
          id="proposal-input"
          rows={3}
          value={inputPrompt}
          maxLength={BLURB_MAX}
          onChange={(event) => {
            setInputPrompt(event.target.value);
          }}
        />
        <label htmlFor="proposal-format">Desired output format</label>
        <input
          id="proposal-format"
          type="text"
          value={outputFormat}
          maxLength={FORMAT_MAX}
          placeholder="JSON allocations per turn"
          onChange={(event) => {
            setOutputFormat(event.target.value);
          }}
        />
        <label htmlFor="proposal-restrictions">Restrictions (optional)</label>
        <textarea
          id="proposal-restrictions"
          rows={2}
          value={restrictions}
          maxLength={BLURB_MAX}
          onChange={(event) => {
            setRestrictions(event.target.value);
          }}
        />
        <h3>Stage dressing (optional)</h3>
        <p className="hint">
          Your own model call designs the trial&apos;s moon dressing from a brief — your
          key, your tokens. Featured trials render it for every bot that plays. Dressing
          is visual only: the swatches, scenery, and tower scales it picks never change
          scoring, goals, or the city itself.
        </p>
        <label htmlFor="proposal-brief">Dressing brief</label>
        <textarea
          id="proposal-brief"
          rows={2}
          value={brief}
          maxLength={BRIEF_MAX}
          placeholder="An ember moon over a lantern grove…"
          onChange={(event) => {
            setBrief(event.target.value);
          }}
        />
        <p className="hint">Start from a brief:</p>
        <p className="cta-row">
          {STARTER_BRIEFS.map((starter) => (
            <Button
              key={starter.label}
              variant="ghost"
              size="xs"
              onClick={() => {
                setBrief(starter.brief);
              }}
            >
              {starter.label}
            </Button>
          ))}
        </p>
        <label htmlFor="proposal-dress-model">Dressing model (your own call)</label>
        <select
          id="proposal-dress-model"
          value={dressModel}
          disabled={models.length === 0}
          onChange={(event) => {
            setDressModel(event.target.value);
          }}
        >
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id} — {entry.kind === "local" ? "local runtime" : "hosted key"}
            </option>
          ))}
        </select>
        <p className="cta-row">
          <Button
            variant="secondary"
            size="small"
            disabled={drafting || !online || brief.trim() === "" || dressModel === ""}
            onClick={() => {
              void generate();
            }}
          >
            {drafting ? "Drafting…" : "Generate dressing"}
          </Button>
          {dressing !== null && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setDressing(null);
                setDraftTokens(null);
              }}
            >
              Clear dressing
            </Button>
          )}
        </p>
        {dressing !== null && (
          <div className="hint dress-preview" role="status" data-drafted="true">
            <p>
              Dressed: {summarizeAssets(dressing)}
              {draftTokens !== null
                ? ` · ${String(draftTokens)} tokens on your call`
                : ""}
            </p>
            <dl className="dress-detail">
              <dt>Moon disc</dt>
              <dd>
                {dressing.palette.moon} swatch · {String(dressing.moon.craters)} craters
                · size {dressing.moon.size.toFixed(2)}×
                {dressing.moon.halo > 0
                  ? ` · halo ${String(Math.round(dressing.moon.halo * 100))}%`
                  : ""}
              </dd>
              <dt>Accents</dt>
              <dd>
                {dressing.palette.accent} accent · {dressing.palette.crane} crane
              </dd>
              <dt>Scenery</dt>
              <dd>
                {String(dressing.scenery.trees)} trees ·{" "}
                {String(dressing.scenery.clouds)} clouds ·{" "}
                {String(dressing.scenery.beacons)} beacons ·{" "}
                {String(dressing.scenery.pennants)} pennants ·{" "}
                {String(dressing.scenery.shrooms)} shrooms ·{" "}
                {String(dressing.scenery.lanterns)} lanterns
              </dd>
              <dt>Towers</dt>
              <dd>
                height {dressing.towers.heightScale.toFixed(2)}× · width{" "}
                {dressing.towers.widthScale.toFixed(2)}×
              </dd>
            </dl>
            <p>Publish to attach this look; Clear dressing plays it bare.</p>
          </div>
        )}
        {!online && (
          <p className="hint" role="status">
            You&apos;re offline — reconnect to propose or vote.
          </p>
        )}
        {onSimulateTrial !== undefined && (
          <p className="hint">
            Simulate now plays this draft straight away — title, description, and
            dressing — without publishing it.
          </p>
        )}
        <p className="cta-row">
          <Button
            variant="primary"
            disabled={
              submitting ||
              !online ||
              title.trim() === "" ||
              description.trim() === "" ||
              model.trim() === "" ||
              inputPrompt.trim() === "" ||
              outputFormat.trim() === ""
            }
            onClick={() => {
              void submit();
            }}
          >
            {submitting ? "Proposing…" : "Propose challenge"}
          </Button>
          {onSimulateTrial !== undefined && (
            <>
              {" "}
              <Button
                variant="secondary"
                disabled={title.trim() === "" || description.trim() === ""}
                title="Play this draft straight away — no proposal needed."
                onClick={() => {
                  onSimulateTrial(
                    localTrialChallenge({
                      title: title.trim(),
                      description: description.trim(),
                      assets: dressing,
                    }),
                  );
                }}
              >
                Simulate now
              </Button>
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="proposals-heading">
        <h2 id="proposals-heading">Community proposals</h2>
        {boardDown && (
          <>
            <p className="error" role="alert">
              Board unreachable — proposals live on the server.
            </p>
            <p className="cta-row">
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  reload();
                }}
              >
                Retry
              </Button>
            </p>
          </>
        )}
        {proposals !== null && proposals.length === 0 && !boardDown && (
          <p className="hint">No proposals yet — yours could be the first.</p>
        )}
        {featured.length > 0 && (
          <>
            <h3>Featured</h3>
            <ul className="proposal-list">
              {featured.map((entry) => (
                <ProposalCard
                  key={entry.id}
                  entry={entry}
                  fresh={entry.id === freshId}
                  freshRef={freshRef}
                  voted={voted.has(entry.id)}
                  voting={voting === entry.id}
                  online={online}
                  own={entry.uid === uid}
                  onVote={() => {
                    void vote(entry);
                  }}
                  onSimulate={
                    onSimulateTrial === undefined
                      ? undefined
                      : () => {
                          onSimulateTrial(rotationChallenge(entry));
                        }
                  }
                  onShare={() => {
                    void shareTrial(entry);
                  }}
                />
              ))}
            </ul>
          </>
        )}
        {open.length > 0 && (
          <>
            <h3>{featured.length > 0 ? "Open votes" : "Open"}</h3>
            <ul className="proposal-list">
              {open.map((entry) => (
                <ProposalCard
                  key={entry.id}
                  entry={entry}
                  fresh={entry.id === freshId}
                  freshRef={freshRef}
                  voted={voted.has(entry.id)}
                  voting={voting === entry.id}
                  online={online}
                  own={entry.uid === uid}
                  onVote={() => {
                    void vote(entry);
                  }}
                  onSimulate={
                    onSimulateTrial === undefined
                      ? undefined
                      : () => {
                          onSimulateTrial(rotationChallenge(entry));
                        }
                  }
                  onShare={() => {
                    void shareTrial(entry);
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function ProposalCard({
  entry,
  fresh,
  freshRef,
  voted,
  voting,
  online,
  own,
  onVote,
  onSimulate,
  onShare,
}: Readonly<{
  entry: CommunityProposal;
  fresh: boolean;
  freshRef: RefObject<HTMLElement | null>;
  voted: boolean;
  voting: boolean;
  online: boolean;
  /** Your own creation: playable now, shareable as a trial code. */
  own: boolean;
  onVote: () => void;
  onSimulate?: () => void;
  onShare: () => void;
}>): React.ReactElement {
  const dressing = parseChallengeAssets(entry.assets);
  return (
    <li>
      <article
        ref={fresh ? freshRef : undefined}
        aria-current={fresh ? "true" : undefined}
      >
        <p className="prompt-meta">
          <span>{byline(entry)}</span>
          <span className="chip">{entry.model}</span>
          {entry.featured && <span className="pill">Featured</span>}
        </p>
        <h4>{entry.title}</h4>
        <p>{entry.description}</p>
        <dl className="proposal-facts">
          <div>
            <dt>Input prompt</dt>
            <dd>{entry.input_prompt}</dd>
          </div>
          <div>
            <dt>Output format</dt>
            <dd>{entry.output_format}</dd>
          </div>
          {entry.restrictions !== null && entry.restrictions !== "" && (
            <div>
              <dt>Restrictions</dt>
              <dd>{entry.restrictions}</dd>
            </div>
          )}
          {dressing.ok && (
            <div>
              <dt>Stage dressing</dt>
              <dd>{summarizeAssets(dressing.value)}</dd>
            </div>
          )}
        </dl>
        <p className="prompt-scores">{voteLabel(entry)}</p>
        <p className="prompt-actions">
          {own && onSimulate !== undefined && (
            <>
              <Button variant="primary" size="small" onClick={onSimulate}>
                Simulate this trial
              </Button>{" "}
              <Button variant="ghost" size="small" onClick={onShare}>
                Copy trial code
              </Button>{" "}
            </>
          )}
          <Button
            variant={own ? "secondary" : "primary"}
            size="small"
            disabled={voted || voting || !online}
            title={online ? undefined : "You're offline — reconnect to vote."}
            onClick={onVote}
          >
            {voting ? "Voting…" : voted ? "Voted" : "Vote"}
          </Button>
        </p>
      </article>
    </li>
  );
}
