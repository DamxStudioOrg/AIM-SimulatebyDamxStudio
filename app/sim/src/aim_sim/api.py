"""Local HTTP API for the match runner. Requires `fastapi` + `uvicorn`.

The simulator core itself stays dependency-free; this module only adapts
it to HTTP for the web app and compose stack.
"""

from __future__ import annotations

import asyncio
import functools
import hmac
import json
import logging
import os
import queue
import re
import threading
import time
from typing import TYPE_CHECKING, Any, TypeVar

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from aim_sim.assets import (
    ASSET_DRAFT_SYSTEM,
    InvalidAssetsError,
    validate_assets,
)
from aim_sim.models import (
    PROMPT_MAX_WORDS,
    TURNS,
    InvalidActionError,
    MatchConfig,
    MatchResult,
    TurnLog,
    validate_interventions,
)
from aim_sim.receipts import sign_payload
from aim_sim.runner import (
    LOCAL_MODEL_PREFIX,
    MAX_PRIOR_GAMES,
    META_DEFAULT_MODELS,
    OLLAMA_MODEL_PREFIX,
    PRIOR_GAME_MAX_WORDS,
    MatchRunner,
    ModelProvider,
    PromptTooLongError,
    RunOptions,
    bionic_models,
    count_words,
    detect_local_models,
    provider_failure_code,
    provider_for_model,
)
from aim_sim.tote import (
    CAPACITY_KG,
    MASTER_CATALOG,
    ToteResult,
    offered_catalog,
    run_tote,
    scarce_ids,
)
from aim_sim.whatif import what_if

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

logger = logging.getLogger(__name__)

LOCAL_PREFIXES = (OLLAMA_MODEL_PREFIX, LOCAL_MODEL_PREFIX)
PROVIDER_KEY_HEADER = "x-provider-key"
SIM_TOKEN_HEADER = "x-sim-token"  # noqa: S105 -- header name, not a secret.
SIM_TOKEN_ENV = "SIM_API_TOKEN"  # noqa: S105 -- env var name, not a secret.
MAX_UID_CHARS = 128
ASSET_PROMPT_MAX_CHARS = 2000
CHALLENGE_PARAMS_MAX_BYTES = 32 * 1024

# DoS bounds on caller-supplied run limits: wide headroom over the
# rated defaults (250 words / 15k budget / 1.2k cap), but every value
# is finite — an unbounded `turns` used to buy an unbounded
# provider-call loop. Turns cap at the rated season: the simulator
# plays exactly TURNS and rejects longer runs, so the gate says so
# up front (422) instead of failing mid-run (502).
RUN_TURNS_MAX = TURNS
RUN_PROMPT_WORDS_MAX = 5_000
RUN_TOKEN_BUDGET_MAX = 1_000_000
RUN_TURN_TOKEN_CAP_MAX = 32_000

# Model id prefix (lowercased) to the single env slot holding its key.
# Closed list on purpose: deriving `<ANYTHING>_API_KEY` from an id
# prefix lets a crafted model id probe or collide with host slots.
_KEY_ENV_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("openai/", "OPENAI_API_KEY"),
    ("gpt-", "OPENAI_API_KEY"),
    ("anthropic/", "ANTHROPIC_API_KEY"),
    ("claude", "ANTHROPIC_API_KEY"),
    ("baseten/", "BASETEN_API_KEY"),
    ("meta/", "META_API_KEY"),
    ("bionic/", "BIONIC_API_KEY"),
    ("gemini/", "GEMINI_API_KEY"),
)


def key_env_for(model: str) -> str | None:
    """One env slot for a model's key, or None when no key applies.

    Local runtimes need no key. Unknown hosted providers resolve to
    None (the run gate rejects them) instead of deriving a slot from
    the id prefix.
    """
    if model.startswith(LOCAL_PREFIXES):
        return None
    lowered = model.lower()
    for prefix, env in _KEY_ENV_BY_PREFIX:
        if lowered.startswith(prefix):
            return env
    return None


_MODEL_CACHE_BUCKET_S = 30.0
_MODEL_CACHE_SLOTS = 8


def _detection_fingerprint() -> tuple[str, ...]:
    """Env inputs to model detection plus a 30s time bucket.

    Detection probes localhost runtimes; without a cache every
    request pays for a full probe pass. The bucket bounds staleness
    to about a minute while the env inputs keep tests hermetic.
    """
    bucket = int(time.monotonic() // _MODEL_CACHE_BUCKET_S)
    return (
        os.environ.get("SIM_MODELS", ""),
        os.environ.get("OLLAMA_HOST", ""),
        os.environ.get("LOCAL_OPENAI_BASE_URL", ""),
        os.environ.get("BIONIC_BASE_URL", ""),
        os.environ.get("META_API_BASE_URL", ""),
        os.environ.get("META_MUSE_BASE_URL", ""),
        str(bucket),
    )


@functools.lru_cache(maxsize=_MODEL_CACHE_SLOTS)
def _enabled_models_cached(fingerprint: tuple[str, ...]) -> tuple[str, ...]:
    """Cached model list for one detection fingerprint."""
    del fingerprint
    raw = os.environ.get("SIM_MODELS", "")
    configured = [entry.strip() for entry in raw.split(",") if entry.strip()]
    ordered = list(detect_local_models())
    ordered.extend(bionic_models())
    for entry in [*META_DEFAULT_MODELS, *configured]:
        if entry not in ordered:
            ordered.append(entry)
    return tuple(ordered)


def _reset_model_cache() -> None:
    """Drop the detection cache; tests use this between cases."""
    _enabled_models_cached.cache_clear()


def enabled_models() -> list[str]:
    """Every playable model id: local runtimes, Bionic, Meta, SIM_MODELS."""
    return list(_enabled_models_cached(_detection_fingerprint()))


def model_kind(model: str) -> str:
    """Placement of a model id: local runtime or hosted key."""
    if model.startswith(LOCAL_PREFIXES):
        return "local"
    return "hosted"


def _scrub(text: str, secret: str | None) -> str:
    """Redact a user key from text before it reaches any log or client."""
    if secret:
        text = text.replace(secret, "[redacted-key]")
    # Redact common API key patterns even if secret not passed
    # sk-..., ghp_..., Meta LLM_.../LLM|...
    text = re.sub(r"(sk-[A-Za-z0-9_-]{10,})", "[redacted-key]", text)
    text = re.sub(r"(ghp_[A-Za-z0-9]{20,})", "[redacted-key]", text)
    text = re.sub(r"(LLM[_|][A-Za-z0-9_|-]{8,})", "[redacted-key]", text)
    # Redact env var values but keep the slot name for debugging.
    return re.sub(r"([A-Z][A-Z0-9_]*_API_KEY)=[^\s\"]+", r"\1=[redacted]", text)


class _GateError(ValueError):
    """A 422 rejection carrying the public error code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _check_key_gate(model: str, uid: object, user_key: str | None) -> None:
    """Validate the identity and key gates for one run.

    Raises _GateError with the public 422 error code.
    """
    if not isinstance(uid, str) or len(uid) > MAX_UID_CHARS:
        code = "invalid_uid"
        raise _GateError(code)
    if model_kind(model) == "hosted" and key_env_for(model) is None:
        code = "unsupported_model_keys"
        raise _GateError(code)
    if model_kind(model) == "hosted" and user_key is None:
        code = "missing_key"
        raise _GateError(code)


_R = TypeVar("_R")


def _provider_failure_detail(exc: BaseException) -> dict[str, str]:
    """502 shape: the fixed error plus a cause code when one is known.

    Unknown failures keep the bare shape — no code is better than a
    code that carries no information, and exception text never leaves
    the server (see test_provider_failure_hides_details).
    """
    detail = {"error": "provider_failed"}
    code = provider_failure_code(exc)
    if code is not None:
        detail["reason"] = code
    return detail


def _guarded_call(prompt: str, user_key: str | None, run: Callable[[], _R]) -> _R:
    """Run the sim, translating runner failures to HTTP errors."""
    try:
        return run()
    except PromptTooLongError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "prompt_too_long",
                "words": count_words(prompt),
                "cap": PROMPT_MAX_WORDS,
            },
        ) from exc
    except RuntimeError as exc:
        if str(exc).startswith("litellm is not installed"):
            raise HTTPException(
                status_code=501,
                detail={
                    "error": "llm_extra_missing",
                    "hint": "install with 'pip install -e .[llm]' in sim/",
                },
            ) from exc
        _log_provider_failure(exc, user_key)
        raise HTTPException(
            status_code=502,
            detail=_provider_failure_detail(exc),
        ) from exc
    except Exception as exc:
        _log_provider_failure(exc, user_key)
        raise HTTPException(
            status_code=502,
            detail=_provider_failure_detail(exc),
        ) from exc


def _check_model(model: str) -> None:
    """Reject unknown models with the shared 422 shape."""
    available = enabled_models()
    if model not in available:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "unknown_model",
                "available": available,
            },
        )


def _config_for_run(body: RunRequest | ToteRequest) -> MatchConfig:
    """Per-run limits; challenge overrides fall back to rated defaults.

    Raises _GateError with the public 422 error code.
    """
    words = getattr(body, "prompt_max_words", None)
    budget = getattr(body, "token_budget", None)
    cap = getattr(body, "turn_token_cap", None)
    params = getattr(body, "challenge_params", None) or {}
    turns = params.get("turns") if isinstance(params, dict) else None
    bounds = (
        (words, RUN_PROMPT_WORDS_MAX),
        (budget, RUN_TOKEN_BUDGET_MAX),
        (cap, RUN_TURN_TOKEN_CAP_MAX),
        (turns, RUN_TURNS_MAX),
    )
    for value, maximum in bounds:
        if value is None:
            continue
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value <= 0
            or value > maximum
        ):
            code = "bad_limits"
            raise _GateError(code)
    defaults = MatchConfig()
    return MatchConfig(
        prompt_max_words=words if words is not None else defaults.prompt_max_words,
        token_budget=budget if budget is not None else defaults.token_budget,
        turn_token_cap=cap if cap is not None else defaults.turn_token_cap,
        turns=turns if turns is not None else defaults.turns,
    )


CHALLENGE_PARAMS_ALLOWED_KEYS = frozenset(
    {"kind", "id", "seed", "goals", "palette", "scenery", "dressing", "turns"}
)
CHALLENGE_PARAMS_MAX_KEYS = 32
_NESTED_VALUE_PENALTY = 256
_SCALAR_VALUE_PENALTY = 32


def _params_shallow_ok(params: dict[object, object]) -> bool:
    """Cheap key/weight guard that runs before expensive serialization."""
    if len(params) > CHALLENGE_PARAMS_MAX_KEYS:
        return False
    approx = 0
    for key, value in params.items():
        if not isinstance(key, str) or key not in CHALLENGE_PARAMS_ALLOWED_KEYS:
            return False
        approx += len(key)
        if isinstance(value, str):
            approx += len(value)
        elif isinstance(value, list | dict):
            approx += _NESTED_VALUE_PENALTY
        else:
            approx += _SCALAR_VALUE_PENALTY
        if approx > CHALLENGE_PARAMS_MAX_BYTES:
            return False
    return True


def _validate_challenge_params(body: RunRequest | ToteRequest) -> None:
    """Validate challenge_params shape and size. Raises _GateError on abuse."""
    code = "bad_challenge_params"
    params = getattr(body, "challenge_params", None)
    if params is None:
        return
    if not isinstance(params, dict) or not _params_shallow_ok(params):
        raise _GateError(code)
    # Size guard: rough JSON size cap ~32 KiB. Deeply nested
    # structures recurse in the serializer instead of failing the
    # shallow key check, so RecursionError rejects here too.
    try:
        size = len(json.dumps(params, separators=(",", ":")))
    except (TypeError, ValueError, RecursionError) as exc:
        raise _GateError(code) from exc
    if size > CHALLENGE_PARAMS_MAX_BYTES:
        raise _GateError(code)


def _chaos_for_run(body: RunRequest) -> float:
    """Validated Fourier chaos level in 0..1; 0 replays legacy worlds.

    Raises _GateError with the public 422 error code.
    """
    level = getattr(body, "chaos_level", 0.0)
    if (
        isinstance(level, bool)
        or not isinstance(level, int | float)
        or not 0.0 <= level <= 1.0
    ):
        code = "bad_chaos_level"
        raise _GateError(code)
    return float(level)


def _prior_games_for_run(body: RunRequest) -> tuple[str, ...]:
    """Validated learning history; at most a few short summaries.

    Raises _GateError with the public 422 error code.
    """
    entries = getattr(body, "prior_games", None) or []
    if len(entries) > MAX_PRIOR_GAMES:
        code = "bad_history"
        raise _GateError(code)
    for entry in entries:
        if not isinstance(entry, str) or count_words(entry) > PRIOR_GAME_MAX_WORDS:
            code = "bad_history"
            raise _GateError(code)
    return tuple(entries)


def _interventions_for_run(body: RunRequest) -> list[object]:
    """Validated field plan; at most 3 entries, one per turn.

    Raises _GateError with the public 422 error code.
    """
    entries = getattr(body, "interventions", None) or []
    try:
        validate_interventions(entries)
    except InvalidActionError as exc:
        code = "bad_interventions"
        raise _GateError(code) from exc
    return list(entries)


def _provider_for_run(model: str, uid: str, user_key: str | None) -> ModelProvider:
    """Resolve the provider for one run, threading the user's key.

    Bring-your-own-key: browser runs never touch host keys, and the
    key rides the provider constructor — never process env — so
    concurrent runs cannot observe each other's credentials. Gate
    rejections become the shared 422 shape.
    """
    try:
        _check_key_gate(model, uid, user_key)
    except _GateError as exc:
        raise HTTPException(status_code=422, detail={"error": exc.code}) from exc
    return provider_for_model(model, user_key)


_LOG_LINE_MAX = 500


def _one_log_line(text: str) -> str:
    """Collapse untrusted failure text to one capped log line.

    Newlines and ANSI escapes would otherwise forge log lines or
    smuggle control sequences into a terminal tailing stdout.
    """
    single = re.sub(r"\s+", " ", text).strip()
    single = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", single)
    return single[:_LOG_LINE_MAX]


def _log_provider_failure(exc: BaseException, secret: str | None) -> None:
    """Local stdout only, with any user key scrubbed out first."""
    logger.warning(
        "provider failed: %s: %s",
        type(exc).__name__,
        _one_log_line(_scrub(str(exc), secret)),
    )


def _request_key(request: object | None) -> str | None:
    """Per-request user key from the header; None when absent or blank."""
    if request is None:
        return None
    headers = getattr(request, "headers", None)
    get = getattr(headers, "get", None)
    raw = get(PROVIDER_KEY_HEADER) if callable(get) else None
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _check_sim_token(request: object | None) -> None:
    """Enforce the shared cloud token on compute endpoints.

    Open when SIM_API_TOKEN is unset (local play); otherwise the
    x-sim-token header must match exactly.
    """
    expected = os.environ.get(SIM_TOKEN_ENV, "")
    if not expected:
        return
    headers = getattr(request, "headers", None)
    get = getattr(headers, "get", None)
    raw = get(SIM_TOKEN_HEADER) if callable(get) else None
    if not isinstance(raw, str):
        raw = ""
    if not hmac.compare_digest(raw.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail={"error": "forbidden"})


class RunRequest(BaseModel):
    """Prompt submission for one match, optionally on a named model."""

    prompt: str
    seed: int = 1
    model: str = ""
    uid: str = ""
    prompt_max_words: int | None = None
    token_budget: int | None = None
    turn_token_cap: int | None = None
    prior_games: list[str] | None = None
    interventions: list[dict[str, Any]] | None = None
    challenge_params: dict[str, Any] | None = None
    chaos_level: float = 0.0


def _match_run_setup(
    body: RunRequest, request: Request
) -> tuple[
    MatchConfig,
    tuple[str, ...],
    list[object],
    float,
    ModelProvider,
    str | None,
]:
    """Guards, config, and provider for a match; shared by run + stream."""
    _check_sim_token(request)
    _check_model(body.model)
    try:
        config = _config_for_run(body)
        history = _prior_games_for_run(body)
        plan = _interventions_for_run(body)
        _validate_challenge_params(body)
        chaos_level = _chaos_for_run(body)
    except _GateError as exc:
        raise HTTPException(status_code=422, detail={"error": exc.code}) from exc
    user_key = _request_key(request)
    provider = _provider_for_run(body.model, getattr(body, "uid", ""), user_key)
    return config, history, plan, chaos_level, provider, user_key


def _receipt_challenge_id(body: RunRequest | ToteRequest) -> str | None:
    """Armed challenge id from the request, if the run carried one."""
    params = getattr(body, "challenge_params", None)
    if not isinstance(params, dict):
        return None
    raw = params.get("id")
    return raw if isinstance(raw, str) else None


def _match_payload(
    result: MatchResult, body: RunRequest, config: MatchConfig
) -> dict[str, object]:
    """HTTP payload for a finished match; shared by run + stream."""
    out: dict[str, object] = {
        "seed": result.seed,
        "provider": result.provider,
        "uid": getattr(body, "uid", ""),
        "chaos_level": result.chaos_level,
        "scores": result.scores,
        "totals": result.totals,
        "loss_reasons": result.loss_reasons,
        "badges": result.badges,
        "strategy": result.strategy,
        "environment": result.environment,
        "prompt_words": result.prompt_words,
        "token_budget": config.token_budget,
        "turns": [
            {
                "turn": log.turn,
                "state_hash": log.state_hash,
                "skip_reason": log.skip_reason,
                "tokens_used": log.tokens_used,
                "thinking_tokens": log.thinking_tokens,
                "usage_anomaly": log.usage_anomaly,
                "spend": log.spend,
                "allocation": dict(log.action.allocation) if log.action else None,
                "policies": list(log.action.policies) if log.action else [],
                "intervention": log.intervention,
                "impact": log.impact,
                "efficiency": log.efficiency,
            }
            for log in result.turns
        ],
    }
    receipt = sign_payload(
        {
            "game": "city",
            "uid": getattr(body, "uid", ""),
            "challenge": _receipt_challenge_id(body),
            "seed": result.seed,
            "model": body.model,
            "provider": result.provider,
            "turns": len(result.turns),
            "impact": result.scores.get("impact", 0.0),
            "efficiency": result.scores.get("efficiency", 0.0),
            "badges": list(result.badges),
        }
    )
    if receipt is not None:
        out["receipt"] = receipt
    return out


def _turn_event(log: TurnLog, number: int, total: int) -> str:
    """One SSE frame for a settled turn: counts, cost, running scores."""
    payload = {
        "type": "turn",
        "turn": number,
        "total": total,
        "tokens_used": log.tokens_used,
        "thinking_tokens": log.thinking_tokens,
        "skipped": log.skip_reason is not None,
        "impact": log.impact,
        "efficiency": log.efficiency,
    }
    return f"data: {json.dumps(payload)}\n\n"


def _acquire_stream_slot() -> None:
    """Take one stream slot; 503 when the house is full."""
    if not _stream_slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail={"error": "busy"})


def _stream_error_frame(exc: BaseException, user_key: str | None) -> str:
    """One terminal SSE error frame for a failed stream run."""
    if isinstance(exc, HTTPException):
        detail = (
            exc.detail if isinstance(exc.detail, dict) else {"error": "provider_failed"}
        )
    else:
        _log_provider_failure(exc, user_key)
        detail = _provider_failure_detail(exc)
    return f"data: {json.dumps({'type': 'error', **detail})}\n\n"


def _match_stream_response(body: RunRequest, request: Request) -> StreamingResponse:
    """Run one match on a worker thread, streaming its turns as SSE.

    Guards run up front, so bad requests still fail as plain HTTP
    errors. The stream then emits one `turn` event per settled turn
    and a final `result` event carrying the same payload as
    POST /matches/run; a mid-run provider failure ends the stream
    with an `error` event instead.
    """
    setup = _match_run_setup(body, request)
    config, history, plan, chaos_level, provider, user_key = setup
    prompt = body.prompt
    # Slot after guards: rejections must not consume stream capacity.
    _acquire_stream_slot()

    async def generate() -> AsyncIterator[str]:
        events: queue.Queue[str | None] = queue.Queue()

        def on_turn(log: TurnLog, number: int, total: int) -> None:
            events.put(_turn_event(log, number, total))

        def work() -> None:
            try:
                outcome = _guarded_call(
                    prompt,
                    user_key,
                    lambda: MatchRunner(config).run(
                        prompt,
                        provider,
                        body.seed,
                        RunOptions(
                            prior_games=history,
                            interventions=plan,
                            challenge_params=getattr(body, "challenge_params", None),
                            chaos_level=chaos_level,
                        ),
                        on_turn=on_turn,
                    ),
                )
            except Exception as exc:  # noqa: BLE001 -- last resort: end the stream, never hang.
                events.put(_stream_error_frame(exc, user_key))
            else:
                events.put(
                    "data: "
                    + json.dumps(
                        {
                            "type": "result",
                            "result": _match_payload(outcome, body, config),
                        }
                    )
                    + "\n\n"
                )
            finally:
                events.put(None)

        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    item = await asyncio.to_thread(events.get, block=True, timeout=0.5)
                except queue.Empty:
                    continue
                if item is None:
                    return
                yield item
        finally:
            _stream_slots.release()

    return StreamingResponse(generate(), media_type="text/event-stream")


class WhatIfRequest(BaseModel):
    """One hypothetical allocation over a recorded match's turns."""

    seed: int = 1
    allocations: list[dict[str, float] | None]
    turn: int
    allocation: dict[str, float]


class ToteRequest(BaseModel):
    """Prompt submission for one tote pack, optionally on a named model."""

    prompt: str
    seed: int = 1
    model: str = ""
    uid: str = ""
    token_budget: int | None = None
    challenge_params: dict[str, Any] | None = None


class DraftRequest(BaseModel):
    """Dressing brief for one creator-model asset draft."""

    prompt: str
    model: str = ""
    uid: str = ""


async def _private_network(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Answer Chrome's private-network preflight for local-sim calls.

    The grant rides only allowlisted origins: stamping it on every
    response would let any site's preflight probe this host.
    """
    response = await call_next(request)
    origin = request.headers.get("origin", "")
    if origin and origin in _cors_origins():
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


# Simple in-memory rate limiting, keyed by direct peer. X-Forwarded-For
# is caller-controlled without a trusted edge, so it must never select
# the bucket — otherwise every request mints a fresh identity.
_rate_limit_store: dict[str, tuple[int, float]] = {}
_RATE_LIMIT_WINDOW = 60.0
_RATE_LIMIT_MAX = 120
_RATE_LIMIT_MAX_CLIENTS = 4096
_BODY_MAX_BYTES = 2 * 1024 * 1024
# Concurrent match streams; each holds a worker thread either way.
_STREAM_SLOTS = 8
_stream_slots = threading.Semaphore(_STREAM_SLOTS)


def _reset_rate_limit() -> None:
    """Drop all rate-limit buckets; tests use this between cases."""
    _rate_limit_store.clear()


async def _body_size_limit(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            if int(cl) > _BODY_MAX_BYTES:
                return Response(status_code=413, content="body too large")
        except ValueError:
            pass
    # The header is advisory (chunked uploads omit it): enforce on
    # the bytes themselves. Starlette caches the body, so endpoints
    # still parse normally afterwards.
    body = await request.body()
    if len(body) > _BODY_MAX_BYTES:
        return Response(status_code=413, content="body too large")
    return await call_next(request)


async def _rate_limit(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    client = request.client.host if request.client else "unknown"
    now = time.time()
    count, start = _rate_limit_store.get(client, (0, now))
    if now - start > _RATE_LIMIT_WINDOW:
        count, start = 0, now
    count += 1
    _rate_limit_store[client] = (count, start)
    if len(_rate_limit_store) > _RATE_LIMIT_MAX_CLIENTS:
        expired = now - _RATE_LIMIT_WINDOW
        stale = [key for key, (_, at) in _rate_limit_store.items() if at < expired]
        for key in stale:
            del _rate_limit_store[key]
    if count > _RATE_LIMIT_MAX:
        return Response(status_code=429, content="too many requests")
    return await call_next(request)


def _draft_assets(body: DraftRequest, request: Request) -> dict[str, object]:
    """Run one creator-model draft call and validate the params.

    The creator's own key (hosted) or runtime (local) pays for the
    call; the sim keeps no copy — publishing stays the board's job.
    """
    _check_sim_token(request)
    _check_model(body.model)
    if len(body.prompt) > ASSET_PROMPT_MAX_CHARS:
        raise HTTPException(status_code=422, detail={"error": "bad_draft"})
    user_key = _request_key(request)
    provider = _provider_for_run(body.model, getattr(body, "uid", ""), user_key)
    completion = _guarded_call(
        body.prompt,
        user_key,
        lambda: provider.complete(ASSET_DRAFT_SYSTEM, body.prompt),
    )
    try:
        raw = json.loads(completion.text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_draft",
                "detail": "model did not return JSON",
            },
        ) from exc
    try:
        params = validate_assets(raw)
    except InvalidAssetsError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_draft", "detail": str(exc)},
        ) from exc
    return {
        "params": params,
        "provider": provider.name,
        "model": body.model,
        "uid": getattr(body, "uid", ""),
        "tokens_used": completion.total_tokens,
    }


JUDGE_PROMPT_MAX_CHARS = 8000
JUDGE_ADVICE_MAX = 3
JUDGE_ADVICE_MAX_CHARS = 160
JUDGE_DIMENSIONS = ("clarity", "specificity", "contingency", "economy")

JUDGE_SYSTEM = (
    "You judge one steward prompt for a city-management simulation. "
    "The user message gives the prompt and the run it produced. Reply "
    'with JSON only, exactly this shape: {"clarity": n, "specificity": n, '
    '"contingency": n, "economy": n, "advice": ["...", "..."]}. Scores '
    "are integers 0-10: clarity (is the strategy legible?), specificity "
    "(numbers, departments, priorities named?), contingency (if/when "
    "plans for the shocks at turns 5 and 9?), economy (tight enough to "
    "never skip a turn?). Advice is at most 3 short lines, each one "
    "concrete change to the prompt. No other keys, no prose."
)


class InvalidJudgeError(ValueError):
    """Raised when a judge reply breaks the verdict schema."""


def validate_judge_reply(data: object) -> dict[str, object]:
    """Validate a raw judge reply; return the normalized verdict."""
    if not isinstance(data, dict):
        msg = "judge reply must be an object"
        raise InvalidJudgeError(msg)
    scores: dict[str, int] = {}
    for dimension in JUDGE_DIMENSIONS:
        value = data.get(dimension)
        if isinstance(value, bool) or not isinstance(value, int | float):
            msg = f"judge reply needs a numeric {dimension}"
            raise InvalidJudgeError(msg)
        scores[dimension] = max(0, min(10, round(value)))
    raw_advice = data.get("advice", [])
    if not isinstance(raw_advice, list):
        msg = "judge advice must be a list"
        raise InvalidJudgeError(msg)
    advice: list[str] = []
    for entry in raw_advice:
        if isinstance(entry, str) and entry.strip():
            advice.append(entry.strip()[:JUDGE_ADVICE_MAX_CHARS])
        if len(advice) >= JUDGE_ADVICE_MAX:
            break
    return {"scores": scores, "advice": advice}


def _judge_prompt(body: DraftRequest, request: Request) -> dict[str, object]:
    """Run one judge call on the player's own model and validate it.

    The player's key (hosted) or runtime (local) pays for the call;
    the sim keeps no copy of the prompt or the verdict.
    """
    _check_sim_token(request)
    _check_model(body.model)
    if len(body.prompt) > JUDGE_PROMPT_MAX_CHARS:
        raise HTTPException(status_code=422, detail={"error": "bad_judge"})
    user_key = _request_key(request)
    provider = _provider_for_run(body.model, getattr(body, "uid", ""), user_key)
    completion = _guarded_call(
        body.prompt,
        user_key,
        lambda: provider.complete(JUDGE_SYSTEM, body.prompt),
    )
    try:
        raw = json.loads(completion.text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_judge",
                "detail": "model did not return JSON",
            },
        ) from exc
    try:
        verdict = validate_judge_reply(raw)
    except InvalidJudgeError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_judge", "detail": str(exc)},
        ) from exc
    return {
        "verdict": verdict,
        "provider": provider.name,
        "model": body.model,
        "uid": getattr(body, "uid", ""),
        "tokens_used": completion.total_tokens,
    }


def _cors_origins() -> list[str]:
    """CORS origins from SIM_CORS_ORIGINS, falling back to localhost."""
    cors_env = os.environ.get("SIM_CORS_ORIGINS", "").strip()
    if cors_env:
        return [o.strip() for o in cors_env.split(",") if o.strip()]
    return ["http://localhost:3000", "http://127.0.0.1:3000"]


_warned: dict[str, bool] = {}


def create_app() -> FastAPI:
    """Build the FastAPI app.

    Request models live at module level so the framework can resolve
    endpoint annotations over real HTTP.
    """
    if not os.environ.get(SIM_TOKEN_ENV, "") and not _warned.get("open_token"):
        logger.warning(
            "SIM_API_TOKEN is not set; the sim API answers without a token. "
            "Set it before exposing this port beyond loopback."
        )
        _warned["open_token"] = True
    app = FastAPI(title="Aim Sim API", version="0.1.0")

    origins = _cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type", "x-provider-key", "x-sim-token"],
    )

    app.middleware("http")(_rate_limit)
    app.middleware("http")(_body_size_limit)
    app.middleware("http")(_private_network)

    @app.get("/contract")
    def contract() -> dict[str, object]:
        """Return the enforced limits so the web app needs no copy of them."""
        config = MatchConfig()
        models = enabled_models()
        return {
            "sim_version": "0.1.0",
            "turns": config.turns,
            "prompt_max_words": config.prompt_max_words,
            "token_budget": config.token_budget,
            "turn_token_cap": config.turn_token_cap,
            "models": [{"id": item, "kind": model_kind(item)} for item in models],
        }

    @app.post("/matches/what-if")
    def run_what_if(body: WhatIfRequest, request: Request) -> dict[str, object]:
        """Preview one swapped allocation; no provider, no token burn."""
        _check_sim_token(request)
        try:
            return what_if(body.seed, body.allocations, body.turn, body.allocation)
        except (InvalidActionError, ValueError) as exc:
            raise HTTPException(
                status_code=422, detail={"error": "bad_what_if"}
            ) from exc

    @app.post("/matches/run")
    def run_match(body: RunRequest, request: Request) -> dict[str, object]:
        """Run one match on the requested local or hosted provider."""
        config, history, plan, chaos_level, provider, user_key = _match_run_setup(
            body, request
        )
        runner = MatchRunner(config)
        result = _guarded_call(
            body.prompt,
            user_key,
            lambda: runner.run(
                body.prompt,
                provider,
                body.seed,
                RunOptions(
                    prior_games=history,
                    interventions=plan,
                    challenge_params=getattr(body, "challenge_params", None),
                    chaos_level=chaos_level,
                ),
            ),
        )
        return _match_payload(result, body, config)

    @app.post("/matches/stream")
    def run_match_stream(body: RunRequest, request: Request) -> StreamingResponse:
        """Run one match, streaming per-turn progress as server-sent events."""
        return _match_stream_response(body, request)

    @app.post("/assets/draft")
    def draft_assets(body: DraftRequest, request: Request) -> dict[str, object]:
        """Draft stage dressing with one creator-model call, validated."""
        return _draft_assets(body, request)

    @app.post("/prompt/judge")
    def judge_prompt(body: DraftRequest, request: Request) -> dict[str, object]:
        """Judge one steward prompt with one player-model call, validated."""
        return _judge_prompt(body, request)

    _register_tote_routes(app)

    return app


def _register_tote_routes(app: FastAPI) -> None:
    """Attach the tote catalog/offer/pack endpoints to the app."""

    @app.get("/tote/catalog")
    def tote_catalog() -> dict[str, object]:
        """Return the full packable catalog; offers are seeded draws of it."""
        return _catalog_payload()

    @app.get("/tote/offer")
    def tote_offer(seed: int = 1) -> dict[str, object]:
        """Return the ten offered ids this seed draws, before packing."""
        offered = offered_catalog(seed)
        return {
            "seed": seed,
            "capacity_kg": CAPACITY_KG,
            "offered": list(offered),
            "scarce": list(scarce_ids(seed, offered)),
        }

    @app.post("/tote/pack")
    def pack_tote(body: ToteRequest, request: Request) -> dict[str, object]:
        """Score one tote packing on the requested provider."""
        _check_sim_token(request)
        _check_model(body.model)
        try:
            config = _config_for_run(body)
            _validate_challenge_params(body)
        except _GateError as exc:
            raise HTTPException(status_code=422, detail={"error": exc.code}) from exc
        user_key = _request_key(request)
        provider = _provider_for_run(body.model, getattr(body, "uid", ""), user_key)
        packed = _guarded_call(
            body.prompt,
            user_key,
            lambda: run_tote(body.prompt, provider, body.seed, config),
        )
        return _tote_payload(packed, body)


def _catalog_payload() -> dict[str, object]:
    """Serialize the packable catalog; offers are seeded draws of it."""
    return {
        "capacity_kg": CAPACITY_KG,
        "items": [
            {
                "id": item.id,
                "label": item.label,
                "weight": item.weight,
                "value": item.value,
                "fragile": item.fragile,
                "tags": list(item.tags),
            }
            for item in MASTER_CATALOG
        ],
    }


def _tote_payload(packed: ToteResult, body: ToteRequest) -> dict[str, object]:
    """Serialize a tote result; uid echoes the submitter for ranking."""
    uid = getattr(body, "uid", "")
    out: dict[str, object] = {
        "seed": packed.seed,
        "provider": packed.provider,
        "uid": uid if isinstance(uid, str) else "",
        "offered": list(packed.offered),
        "packing": list(packed.packing),
        "value": packed.value,
        "damage": {
            "overweight": packed.overweight,
            "crush": packed.crush,
            "stain": packed.stain,
            "cut": packed.cut,
            "total": packed.damage,
        },
        "score": packed.score,
        "totals": {
            "tokens_used": packed.tokens_used,
            "thinking_tokens": packed.thinking_tokens,
        },
        "invalid_reason": packed.invalid_reason,
        "scarce": list(packed.scarce),
        "wildcards": list(packed.wildcards),
        "badges": list(packed.badges),
        "bonus": packed.bonus,
        "usage_anomaly": packed.usage_anomaly,
    }
    receipt = sign_payload(
        {
            "game": "tote",
            "uid": out["uid"],
            "challenge": _receipt_challenge_id(body),
            "seed": packed.seed,
            "model": body.model,
            "provider": packed.provider,
            "score": packed.score,
            "badges": list(packed.badges),
        }
    )
    if receipt is not None:
        out["receipt"] = receipt
    return out
