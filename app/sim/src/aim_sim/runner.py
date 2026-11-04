"""Match runner: prompt caps, token budgets, providers, and replay logs."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

from aim_sim.models import (
    ALLOCATION_KEYS,
    SIM_VERSION,
    TURNS,
    AgentAction,
    InvalidActionError,
    MatchConfig,
    MatchResult,
    ProviderCompletion,
    TurnLog,
    validate_interventions,
)
from aim_sim.scoring import badges, full_scores, loss_reasons, strategy_fingerprint
from aim_sim.simulator import ResilientCitySim

ESTIMATE_WORD_TOKENS = 1
ESTIMATE_CHAR_TOKENS_DIVISOR = 4
ESTIMATE_BASE_TOKENS = 8
USAGE_ANOMALY_RATIO = 3
MAX_PRIOR_GAMES = 3
PRIOR_GAME_MAX_WORDS = 200

CITY_REPLY_SHAPE = (
    'Reply with JSON only, exactly this shape: {"allocation": {'
    '"housing": n, "transit": n, "health": n, "green": n, '
    '"reserves": n, "rescue": n, "shelter": n, "repair": n}, '
    '"policies": [], "note": ""}. The 8 allocation numbers must sum to '
    "100. Policies: 0-2 of evacuate_district, open_shelters, "
    "ration_water, emergency_hire_medics, curfew, request_mutual_aid."
)

OLLAMA_MODEL_PREFIX = "ollama/"
LOCAL_MODEL_PREFIX = "local/"
META_MODEL_PREFIX = "meta/"
BIONIC_MODEL_PREFIX = "bionic/"
BIONIC_BASE_URL_ENV = "BIONIC_BASE_URL"
BIONIC_API_KEY_ENV = "BIONIC_API_KEY"
OLLAMA_HOST_DEFAULT = "http://localhost:11434"
LOCAL_OPENAI_URL_DEFAULT = "http://localhost:1234/v1"
# Stock LM Studio ports, in try order, when no base is configured:
# 1234 is the documented default; 1235 is where a second instance
# (or a port-shifted first one) answers on this class of machine.
LOCAL_OPENAI_FALLBACK_URLS = (
    "http://localhost:1234/v1",
    "http://localhost:1235/v1",
)
META_API_BASE_DEFAULT = "https://api.llama.com/compat/v1"
META_API_BASE_ENV = "META_API_BASE_URL"
META_API_KEY_ENV = "META_API_KEY"
# Muse models (Spark, Wonder) live on the Meta Model API, not the
# Llama API host; one Meta token pays for both. The `muse-` name
# prefix routes a meta/* model to the Model API base below.
META_MUSE_BASE_DEFAULT = "https://api.meta.ai/v1"
META_MUSE_BASE_ENV = "META_MUSE_BASE_URL"
META_MUSE_NAME_PREFIX = "muse-"
META_DEFAULT_MODELS = (
    "meta/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "meta/Llama-4-Scout-17B-16E-Instruct",
    "meta/Llama-3.3-70B-Instruct",
    "meta/muse-spark-1.3",
    "meta/muse-wonder-1.0",
)
DETECT_TIMEOUT_S = 2.0
LOCAL_CALL_TIMEOUT_S = 300.0
META_CALL_TIMEOUT_S = 300.0
LOCAL_MAX_TOKENS = 3000


def count_words(text: str) -> int:
    """Whitespace word count used for the prompt cap."""
    return len(text.split())


def estimate_tokens(text: str) -> int:
    """Deterministic token estimate when a provider reports no usage.

    Test doubles and local runtimes without usage counters use this so
    every path exercises the same budget plumbing.
    """
    return (
        ESTIMATE_BASE_TOKENS
        + count_words(text) * ESTIMATE_WORD_TOKENS
        + len(text) // ESTIMATE_CHAR_TOKENS_DIVISOR
    )


def usage_anomaly(reported: int, expected: int) -> bool:
    """True when provider-reported usage diverges wildly from the estimate.

    Either direction flags: under-reporting dodges the token budget,
    over-reporting inflates bills and efficiency dilution.
    """
    if expected <= 0 or reported < 0:
        return False
    return (
        reported > expected * USAGE_ANOMALY_RATIO
        or reported * USAGE_ANOMALY_RATIO < expected
    )


def _reasoning_tokens(usage: object) -> int:
    """Thinking-trace tokens inside an OpenAI-style usage map, else 0.

    Thinking models report reasoning inside completion_tokens with the
    split in completion_tokens_details; anything missing or malformed
    reads as zero so gameplay bills the full completion as before.
    """
    if not isinstance(usage, dict):
        return 0
    details = usage.get("completion_tokens_details")
    if not isinstance(details, dict):
        return 0
    reasoning = details.get("reasoning_tokens")
    if not isinstance(reasoning, int) or isinstance(reasoning, bool) or reasoning < 0:
        return 0
    return reasoning


class ModelProvider(ABC):
    """One model call per turn. Implementations report true token usage."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable provider build label recorded in replays."""

    @abstractmethod
    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """Return the model's raw turn output for the given state."""


def _tote_packing_from_state(state_json: str) -> list[str] | None:
    """Offered ids in draw order when the state is a tote offer, else None.

    The mock ignores prompt text in both games; for tote states it packs the
    offered catalog as drawn so the offline path stays playable and scored.
    """
    try:
        state = json.loads(state_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(state, dict):
        return None
    offered = state.get("offered")
    if not isinstance(offered, list) or not offered:
        return None
    if any(not isinstance(entry, str) for entry in offered):
        return None
    return [entry for entry in offered if isinstance(entry, str)]


class MockProvider(ModelProvider):
    """Deterministic test double playing a fixed balanced strategy.

    Not served over the API: the product surface is local runtimes plus
    hosted models. Tests use this (and ScriptedProvider) for exact,
    network-free replays.
    """

    def __init__(self, label: str = "mock-0") -> None:
        """Store the replay label."""
        self._label = label

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return self._label

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """Return a fixed balanced allocation; usage is estimated."""
        del system_prompt
        tote_packing = _tote_packing_from_state(state_json)
        if tote_packing is not None:
            text = json.dumps({"packing": tote_packing})
            return ProviderCompletion(
                text=text,
                prompt_tokens=estimate_tokens(state_json),
                completion_tokens=estimate_tokens(text),
            )
        text = json.dumps(
            {
                "allocation": {
                    "housing": 15.0,
                    "transit": 10.0,
                    "health": 15.0,
                    "green": 10.0,
                    "reserves": 15.0,
                    "rescue": 12.0,
                    "shelter": 11.0,
                    "repair": 12.0,
                },
                "policies": [],
                "note": "mock",
            }
        )
        return ProviderCompletion(
            text=text,
            prompt_tokens=estimate_tokens(state_json),
            completion_tokens=estimate_tokens(text),
        )


class ScriptedProvider(ModelProvider):
    """Test provider yielding canned outputs turn by turn."""

    def __init__(self, outputs: list[str], label: str = "scripted-test") -> None:
        """Store the canned outputs replayed in order."""
        self._outputs = list(outputs)
        self._label = label

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return self._label

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """Replay the next canned output; reuse the last when exhausted."""
        del system_prompt
        text = self._outputs.pop(0) if len(self._outputs) > 1 else self._outputs[0]
        return ProviderCompletion(
            text=text,
            prompt_tokens=estimate_tokens(state_json),
            completion_tokens=estimate_tokens(text),
        )


def _get_json(url: str, timeout_s: float, api_key: str = "") -> dict[str, object]:
    """GET a JSON document; used only against operator-configured hosts."""
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    request = urllib.request.Request(url, method="GET", headers=headers)  # noqa: S310 -- operator host
    with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310 -- operator host
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        msg = f"expected a JSON object from {url}"
        raise TypeError(msg)
    return data


def _post_json(
    url: str,
    payload: dict[str, object],
    timeout_s: float,
    api_key: str = "",
    label: str = "local model",
) -> dict[str, object]:
    """POST a JSON document; used only against operator-configured hosts."""
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(  # noqa: S310 -- operator host
        url, data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310 -- operator host
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        msg = f"{label} call failed with HTTP {exc.code}: {detail}"
        raise RuntimeError(msg) from exc
    except urllib.error.URLError as exc:
        msg = f"{label} host unreachable: {exc.reason}"
        raise RuntimeError(msg) from exc
    data = json.loads(raw)
    if not isinstance(data, dict):
        msg = f"{label} returned a non-object response"
        raise TypeError(msg)
    return data


def ollama_host() -> str:
    """Ollama base URL from the environment, localhost by default."""
    return os.environ.get("OLLAMA_HOST", OLLAMA_HOST_DEFAULT).rstrip("/")


def local_openai_url() -> str:
    """OpenAI-compatible base URL (LM Studio, llama.cpp server, vLLM)."""
    return os.environ.get("LOCAL_OPENAI_BASE_URL", LOCAL_OPENAI_URL_DEFAULT).rstrip("/")


def meta_api_url(model_name: str = "") -> str:
    """Meta API base URL for one model name (without the `meta/` prefix).

    Muse models route to the Model API host, Llama models to the
    Llama API host; each side honors its own base-URL override so
    tests can point either at a stub.
    """
    if model_name.startswith(META_MUSE_NAME_PREFIX):
        return os.environ.get(META_MUSE_BASE_ENV, META_MUSE_BASE_DEFAULT).rstrip("/")
    return os.environ.get(META_API_BASE_ENV, META_API_BASE_DEFAULT).rstrip("/")


def bionic_url() -> str:
    """BionicGPT base URL (with /v1) from the environment; empty when unset."""
    return os.environ.get(BIONIC_BASE_URL_ENV, "").rstrip("/")


def bionic_models(timeout_s: float = DETECT_TIMEOUT_S) -> list[str]:
    """Model ids a configured BionicGPT instance serves, as `bionic/<id>`.

    Like the Ollama probe: an unset base URL or a down instance yields
    nothing, never an error.
    """
    base = bionic_url()
    if not base:
        return []
    try:
        data = _get_json(
            f"{base}/models", timeout_s, os.environ.get(BIONIC_API_KEY_ENV, "")
        )
    except Exception:  # noqa: BLE001 -- any failure means "Bionic is down"
        return []
    entries = data.get("data")
    if not isinstance(entries, list):
        return []
    ids: list[str] = []
    for entry in entries:
        ref = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(ref, str) and ref:
            ids.append(f"{BIONIC_MODEL_PREFIX}{ref}")
    return ids


def provider_failure_code(exc: BaseException) -> str | None:
    """Fixed failure class for a provider error, None when unknown.

    Clients receive the code — never exception text — so a 502 can
    name the cause without leaking key material or backend detail.
    """
    if isinstance(exc, TimeoutError):
        return "timeout"
    text = str(exc)
    http = re.search(r"HTTP (\d{3})", text)
    if http is not None:
        return "model_missing" if http.group(1) == "404" else "rejected"
    if "host unreachable" in text:
        return "unreachable"
    if "no message content" in text:
        return "empty_reply"
    return None


def ollama_models(timeout_s: float = DETECT_TIMEOUT_S) -> list[str]:
    """Model ids Ollama currently serves, as `ollama/<tag>` entries."""
    try:
        data = _get_json(f"{ollama_host()}/api/tags", timeout_s)
    except Exception:  # noqa: BLE001 -- any failure means "Ollama is down"
        return []
    models = data.get("models")
    if not isinstance(models, list):
        return []
    ids: list[str] = []
    for entry in models:
        name = entry.get("name") if isinstance(entry, dict) else None
        if isinstance(name, str) and name:
            ids.append(f"{OLLAMA_MODEL_PREFIX}{name}")
    return ids


def local_openai_urls() -> list[str]:
    """OpenAI-compatible bases to try, in order.

    An explicit `LOCAL_OPENAI_BASE_URL` wins alone (the operator
    pointed somewhere deliberate). Otherwise the conventional
    defaults: 1234 first (LM Studio's stock port), then 1235 —
    LM Studio serves there whenever its server binds the next
    port or a second instance runs, and a 1234-only default made
    those models invisible to the contract and the dropdown.
    """
    configured = os.environ.get("LOCAL_OPENAI_BASE_URL", "").strip()
    if configured:
        return [configured.rstrip("/")]
    return list(LOCAL_OPENAI_FALLBACK_URLS)


# Which base served each discovered `local/<name>`, from the latest
# detection pass — provider calls route to the base that listed the
# model instead of assuming the first candidate answers for all.
_MODEL_BASES: dict[str, str] = {}


def local_base_for(model_name: str) -> str:
    """Base that serves one local model name, discovering if needed."""
    known = _MODEL_BASES.get(model_name)
    if known is not None:
        return known
    detect_local_models()
    return _MODEL_BASES.get(model_name, local_openai_urls()[0])


def openai_compat_models(timeout_s: float = DETECT_TIMEOUT_S) -> list[str]:
    """Model ids on the OpenAI-compatible endpoints, as `local/<id>`."""
    ids: list[str] = []
    seen: set[str] = set()
    for base in local_openai_urls():
        try:
            data = _get_json(f"{base}/models", timeout_s)
        except Exception:  # noqa: BLE001 -- a down endpoint yields nothing
            data = {}
        entries = data.get("data")
        if not isinstance(entries, list):
            continue
        for entry in entries:
            ref = entry.get("id") if isinstance(entry, dict) else None
            if isinstance(ref, str) and ref and ref not in seen:
                seen.add(ref)
                _MODEL_BASES[ref] = base
                ids.append(f"{LOCAL_MODEL_PREFIX}{ref}")
    return ids


def detect_local_models() -> list[str]:
    """Every locally served model id, deduplicated, Ollama first."""
    seen: set[str] = set()
    ordered: list[str] = []
    for model in [*ollama_models(), *openai_compat_models()]:
        if model not in seen:
            seen.add(model)
            ordered.append(model)
    return ordered


class OllamaProvider(ModelProvider):
    """Ollama runtime over its native chat API. No key, localhost default."""

    def __init__(self, model: str) -> None:
        """Store the `ollama/<tag>` id; the tag selects the served model."""
        if not model.startswith(OLLAMA_MODEL_PREFIX):
            msg = f"ollama model id must start with {OLLAMA_MODEL_PREFIX!r}"
            raise TypeError(msg)
        self._tag = model[len(OLLAMA_MODEL_PREFIX) :]

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return f"ollama:{self._tag}"

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """One chat call; usage is authoritative, estimated when absent.

        Thinking models think out loud in the `thinking` field while
        `eval_count` covers the whole call. Gameplay bills prompt plus
        answer only, so the trace is estimated out of the completion —
        the models need their thinking to follow the reply shape.
        """
        try:
            data = _post_json(
                f"{ollama_host()}/api/chat",
                {
                    "model": self._tag,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state_json},
                    ],
                    "stream": False,
                    "format": "json",
                    "options": {"num_predict": LOCAL_MAX_TOKENS, "temperature": 0},
                },
                LOCAL_CALL_TIMEOUT_S,
            )
        except RuntimeError as exc:
            msg = f"ollama call failed: {exc}"
            raise RuntimeError(msg) from exc
        message = data.get("message")
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text:
            msg = "ollama returned no message content"
            raise RuntimeError(msg)
        prompt_tokens = data.get("prompt_eval_count", 0)
        completion_tokens = data.get("eval_count", 0)
        if not isinstance(prompt_tokens, int) or prompt_tokens <= 0:
            prompt_tokens = estimate_tokens(system_prompt + state_json)
        if not isinstance(completion_tokens, int) or completion_tokens <= 0:
            completion_tokens = estimate_tokens(text)
        thinking = message.get("thinking") if isinstance(message, dict) else None
        reasoning_tokens = (
            estimate_tokens(thinking) if isinstance(thinking, str) and thinking else 0
        )
        return ProviderCompletion(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
        )


ACTION_JSON_SCHEMA: dict[str, object] = {
    "name": "agent_action",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "allocation": {
                "type": "object",
                "properties": {key: {"type": "number"} for key in ALLOCATION_KEYS},
                "required": list(ALLOCATION_KEYS),
                "additionalProperties": False,
            },
            "policies": {"type": "array", "items": {"type": "string"}},
            "note": {"type": "string"},
        },
        "required": ["allocation", "policies", "note"],
        "additionalProperties": False,
    },
}

RESPONSE_FORMAT_FALLBACKS: tuple[dict[str, object] | None, ...] = (
    {"type": "json_object"},
    {"type": "json_schema", "json_schema": ACTION_JSON_SCHEMA},
    None,
)


class LocalOpenAIProvider(ModelProvider):
    """Any OpenAI-compatible local server: LM Studio, llama.cpp, vLLM."""

    def __init__(self, model: str, api_key: str | None = None) -> None:
        """Store the `local/<name>` id; an explicit key beats the env slot."""
        if not model.startswith(LOCAL_MODEL_PREFIX):
            msg = f"local model id must start with {LOCAL_MODEL_PREFIX!r}"
            raise TypeError(msg)
        self._name = model[len(LOCAL_MODEL_PREFIX) :]
        self._api_key = api_key

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return f"local:{self._name}"

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """Chat-completions call with response-format retries.

        Local servers disagree on supported formats: LM Studio rejects
        `json_object` with HTTP 400, so on a format rejection we retry with
        `json_schema`, then with no format at all (the system prompt already
        demands JSON only). The call goes to the base that listed this
        model at detection time (1234 or the 1235 fallback alike).
        """
        base = local_base_for(self._name)
        data: dict[str, object] | None = None
        for response_format in RESPONSE_FORMAT_FALLBACKS:
            payload: dict[str, object] = {
                "model": self._name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": state_json},
                ],
                "max_tokens": LOCAL_MAX_TOKENS,
                "temperature": 0,
            }
            if response_format is not None:
                payload["response_format"] = response_format
            try:
                key = (
                    self._api_key
                    if self._api_key is not None
                    else os.environ.get("LOCAL_OPENAI_API_KEY", "")
                )
                data = _post_json(
                    f"{base}/chat/completions",
                    payload,
                    LOCAL_CALL_TIMEOUT_S,
                    key,
                )
            except RuntimeError as exc:
                if "response_format" not in str(exc) or response_format is None:
                    msg = f"local openai-compatible call failed: {exc}"
                    raise RuntimeError(msg) from exc
                continue
            break
        if data is None:  # pragma: no cover - the bare attempt breaks or raises
            msg = "local openai-compatible call failed: no response"
            raise RuntimeError(msg)
        choices = data.get("choices")
        first = choices[0] if isinstance(choices, list) and choices else None
        message = first.get("message") if isinstance(first, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text:
            msg = "local server returned no message content"
            raise RuntimeError(msg)
        usage = data.get("usage")
        usage_map = usage if isinstance(usage, dict) else {}
        prompt_tokens = usage_map.get("prompt_tokens", 0)
        completion_tokens = usage_map.get("completion_tokens", 0)
        if not isinstance(prompt_tokens, int) or prompt_tokens <= 0:
            prompt_tokens = estimate_tokens(system_prompt + state_json)
        if not isinstance(completion_tokens, int) or completion_tokens <= 0:
            completion_tokens = estimate_tokens(text)
        return ProviderCompletion(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=_reasoning_tokens(usage_map),
        )


def provider_for_model(model: str, api_key: str | None = None) -> ModelProvider:
    """Build the provider a model id routes to, threading one key.

    The key rides the constructor — never process env — so concurrent
    hosted runs cannot observe each other's credentials.
    """
    if model.startswith(OLLAMA_MODEL_PREFIX):
        return OllamaProvider(model)
    if model.startswith(LOCAL_MODEL_PREFIX):
        return LocalOpenAIProvider(model, api_key)
    if model.startswith(META_MODEL_PREFIX):
        return MetaProvider(model, api_key)
    if model.startswith(BIONIC_MODEL_PREFIX):
        return BionicProvider(model, api_key)
    return LiteLLMProvider(model, api_key=api_key)


class MetaProvider(ModelProvider):
    """Meta Llama and Model APIs over their OpenAI-compatible endpoints."""

    def __init__(self, model: str, api_key: str | None = None) -> None:
        """Store the `meta/<name>` id; an explicit key beats the env slot."""
        if not model.startswith(META_MODEL_PREFIX):
            msg = f"meta model id must start with {META_MODEL_PREFIX!r}"
            raise TypeError(msg)
        self._name = model[len(META_MODEL_PREFIX) :]
        self._api_key = api_key

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return f"meta:{self._name}"

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """One chat-completions call; usage falls back to estimates."""
        key = (
            self._api_key
            if self._api_key is not None
            else os.environ.get(META_API_KEY_ENV, "")
        )
        try:
            data = _post_json(
                f"{meta_api_url(self._name)}/chat/completions",
                {
                    "model": self._name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state_json},
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": LOCAL_MAX_TOKENS,
                    "temperature": 0,
                },
                META_CALL_TIMEOUT_S,
                key,
                "meta model",
            )
        except RuntimeError as exc:
            msg = f"meta call failed: {exc}"
            raise RuntimeError(msg) from exc
        choices = data.get("choices")
        first = choices[0] if isinstance(choices, list) and choices else None
        message = first.get("message") if isinstance(first, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text:
            msg = "meta returned no message content"
            raise RuntimeError(msg)
        usage = data.get("usage")
        usage_map = usage if isinstance(usage, dict) else {}
        prompt_tokens = usage_map.get("prompt_tokens", 0)
        completion_tokens = usage_map.get("completion_tokens", 0)
        if not isinstance(prompt_tokens, int) or prompt_tokens <= 0:
            prompt_tokens = estimate_tokens(system_prompt + state_json)
        if not isinstance(completion_tokens, int) or completion_tokens <= 0:
            completion_tokens = estimate_tokens(text)
        return ProviderCompletion(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=_reasoning_tokens(usage_map),
        )


class BionicProvider(ModelProvider):
    """BionicGPT over its OpenAI-compatible API, keyed per call.

    The instance is the user's own (BIONIC_BASE_URL, including /v1);
    the key is the per-LLM API key Bionic issues, supplied per run
    through the device vault like other hosted keys.
    """

    def __init__(self, model: str, api_key: str | None = None) -> None:
        """Store the `bionic/<name>` id; an explicit key beats the env slot."""
        if not model.startswith(BIONIC_MODEL_PREFIX):
            msg = f"bionic model id must start with {BIONIC_MODEL_PREFIX!r}"
            raise TypeError(msg)
        self._name = model[len(BIONIC_MODEL_PREFIX) :]
        self._api_key = api_key

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return f"bionic:{self._name}"

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """One chat-completions call; usage falls back to estimates."""
        base = bionic_url()
        if not base:
            msg = "BIONIC_BASE_URL is not set; point it at your BionicGPT /v1 API"
            raise RuntimeError(msg)
        key = (
            self._api_key
            if self._api_key is not None
            else os.environ.get(BIONIC_API_KEY_ENV, "")
        )
        try:
            data = _post_json(
                f"{base}/chat/completions",
                {
                    "model": self._name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state_json},
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": LOCAL_MAX_TOKENS,
                    "temperature": 0,
                },
                META_CALL_TIMEOUT_S,
                key,
                "bionic model",
            )
        except RuntimeError as exc:
            msg = f"bionic call failed: {exc}"
            raise RuntimeError(msg) from exc
        choices = data.get("choices")
        first = choices[0] if isinstance(choices, list) and choices else None
        message = first.get("message") if isinstance(first, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text:
            msg = "bionic returned no message content"
            raise RuntimeError(msg)
        usage = data.get("usage")
        usage_map = usage if isinstance(usage, dict) else {}
        prompt_tokens = usage_map.get("prompt_tokens", 0)
        completion_tokens = usage_map.get("completion_tokens", 0)
        if not isinstance(prompt_tokens, int) or prompt_tokens <= 0:
            prompt_tokens = estimate_tokens(system_prompt + state_json)
        if not isinstance(completion_tokens, int) or completion_tokens <= 0:
            completion_tokens = estimate_tokens(text)
        return ProviderCompletion(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=_reasoning_tokens(usage_map),
        )


class LiteLLMProvider(ModelProvider):
    """Multi-provider gateway. Requires `litellm` installed and keys in env."""

    def __init__(
        self, model: str, label: str | None = None, api_key: str | None = None
    ) -> None:
        """Store the LiteLLM model string, e.g. 'gpt-4o' or 'anthropic/...'."""
        self._model = model
        self._label = label or f"litellm:{model}"
        self._api_key = api_key

    @property
    def name(self) -> str:
        """Stable provider build label recorded in replays."""
        return self._label

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        """Call the model once and return text with authoritative usage."""
        try:
            import litellm
        except ImportError as exc:
            msg = (
                "litellm is not installed; install sim extra 'llm' to use this provider"
            )
            raise RuntimeError(msg) from exc
        call_kwargs: dict[str, object] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": state_json},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": TURNS * 100,
            "temperature": 0,
        }
        if self._api_key is not None:
            call_kwargs["api_key"] = self._api_key
        response = litellm.completion(**call_kwargs)
        text = response["choices"][0]["message"]["content"] or ""
        usage = response.get("usage", {}) or {}
        return ProviderCompletion(
            text=text,
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
            reasoning_tokens=_reasoning_tokens(usage),
        )


class PromptTooLongError(ValueError):
    """Raised when a submitted prompt exceeds the word cap."""


def _history_block(prior_games: tuple[str, ...]) -> str:
    """System-prompt prefix carrying past-game summaries for learning.

    Raises:
        ValueError: If more than MAX_PRIOR_GAMES arrive or one tops
            PRIOR_GAME_MAX_WORDS.

    """
    if len(prior_games) > MAX_PRIOR_GAMES:
        msg = f"at most {MAX_PRIOR_GAMES} prior games, got {len(prior_games)}"
        raise ValueError(msg)
    for entry in prior_games:
        entry_words = count_words(entry)
        if entry_words > PRIOR_GAME_MAX_WORDS:
            msg = f"prior game has {entry_words} words, cap is {PRIOR_GAME_MAX_WORDS}"
            raise ValueError(msg)
    if not prior_games:
        return ""
    lines = [f"Prior games ({len(prior_games)}, oldest first):"]
    lines.extend(f"{index}. {entry}" for index, entry in enumerate(prior_games, 1))
    return "\n".join(lines) + "\n\n"


@dataclass(frozen=True)
class RunOptions:
    """Per-run extras that are not part of the rated match limits."""

    prior_games: tuple[str, ...] = ()
    interventions: object = ()
    challenge_params: dict[str, object] | None = None
    chaos_level: float = 0.0


class MatchRunner:
    """Plays prompts against the simulator with enforced budgets."""

    def __init__(self, config: MatchConfig | None = None) -> None:
        """Store match limits; defaults are the rated-ladder values."""
        self._config = config or MatchConfig()

    def run(
        self,
        prompt: str,
        provider: ModelProvider,
        seed: int,
        options: RunOptions | None = None,
        on_turn: Callable[[TurnLog, int, int], None] | None = None,
    ) -> MatchResult:
        """Play one full match and return the scored replay record.

        Up to MAX_PRIOR_GAMES past-game summaries may ride along so the
        agent can learn; each is capped at PRIOR_GAME_MAX_WORDS to stop
        seed overfitting and prompt smuggling. A field plan of at most
        3 interventions fires each entry before the bot moves that turn.
        `on_turn` fires after every turn — played or skipped — with the
        turn log, the 1-based turn number, and the turn total, so live
        progress never needs a second code path.
        """
        opts = options if options is not None else RunOptions()
        words = count_words(prompt)
        if words > self._config.prompt_max_words:
            msg = f"prompt has {words} words, cap is {self._config.prompt_max_words}"
            raise PromptTooLongError(msg)
        history = _history_block(opts.prior_games)
        plan = validate_interventions(opts.interventions)
        due = {entry.turn: entry.kind for entry in plan}
        sim = ResilientCitySim(seed, chaos_level=opts.chaos_level)
        result = MatchResult(
            sim_version=SIM_VERSION,
            seed=seed,
            prompt_words=words,
            provider=provider.name,
            chaos_level=sim.chaos_level,
        )
        spent_tokens = 0
        # Recorded usage trails true spend: invalid turns burn budget but
        # log zero usage, and running boards must match the finished
        # boards, which dilute on recorded usage only.
        scored_tokens = 0
        turns = getattr(self._config, "turns", TURNS)
        for _ in range(turns):
            fired = due.get(sim.turn + 1)
            if fired is not None:
                sim.land.intervene(fired)
            remaining = self._config.token_budget - spent_tokens
            state_hash = sim.state_hash()
            if remaining <= 0:
                self._record_skip(
                    sim,
                    result,
                    state_hash,
                    "budget_exhausted",
                    fired,
                    scored_tokens,
                    on_turn,
                    turns,
                )
                continue
            system = f"{history}{prompt}\n\n{CITY_REPLY_SHAPE}"
            state_json = self._state_json(sim, remaining)
            completion = provider.complete(system, state_json)
            turn_tokens = completion.game_tokens
            expected = estimate_tokens(system + state_json) + estimate_tokens(
                completion.text
            )
            anomaly = usage_anomaly(turn_tokens, expected)
            if turn_tokens > self._config.turn_token_cap:
                self._record_skip(
                    sim,
                    result,
                    state_hash,
                    "turn_token_cap",
                    fired,
                    scored_tokens,
                    on_turn,
                    turns,
                )
                continue
            spent_tokens += turn_tokens
            action = self._parse_action(completion.text)
            if action is None:
                self._record_skip(
                    sim,
                    result,
                    state_hash,
                    "invalid_output",
                    fired,
                    scored_tokens,
                    on_turn,
                    turns,
                )
                continue
            scored_tokens += turn_tokens
            spend = sim.step(action)
            running = full_scores(sim, scored_tokens)
            self._record_turn(
                result,
                TurnLog(
                    turn=sim.turn,
                    state_hash=state_hash,
                    action=action,
                    skip_reason=None,
                    tokens_used=turn_tokens,
                    spend=spend,
                    usage_anomaly=anomaly,
                    intervention=fired,
                    impact=running["impact"],
                    efficiency=running["efficiency"],
                    thinking_tokens=completion.reasoning_tokens,
                ),
                on_turn,
                turns,
            )
        result.scores = full_scores(sim, result.tokens_used)
        result.totals = {
            "spend": sim.spend_total,
            "wasted_spend": sim.wasted_spend,
            "lives_stabilized": float(sim.lives_stabilized),
            "lives_lost": float(sum(sim.lives_lost_by_kind.values())),
            "lives_lost_flood": float(sim.lives_lost_by_kind.get("flood", 0)),
            "lives_lost_heatwave": float(sim.lives_lost_by_kind.get("heatwave", 0)),
            "lives_lost_infra_failure": float(
                sim.lives_lost_by_kind.get("infra_failure", 0)
            ),
            "skipped_turns": float(sim.skipped_turns),
            "tokens_used": float(result.tokens_used),
            "thinking_tokens": float(result.thinking_tokens),
            "prior_games_used": float(len(opts.prior_games)),
            "interventions_used": float(len(plan)),
            "usage_anomalies": float(
                sum(1 for log in result.turns if log.usage_anomaly)
            ),
        }
        result.loss_reasons = loss_reasons(sim, result.tokens_used)
        result.badges = badges(sim)
        result.strategy = strategy_fingerprint(result.turns)
        env_snapshot = sim.land.snapshot()
        if opts.challenge_params:
            env_snapshot = dict(env_snapshot)
            env_snapshot["challenge_params"] = opts.challenge_params
        result.environment = env_snapshot
        return result

    @staticmethod
    def _record_turn(
        result: MatchResult,
        log: TurnLog,
        on_turn: Callable[[TurnLog, int, int], None] | None,
        total: int,
    ) -> None:
        """Append one settled turn and report it to a progress hook, if any."""
        result.turns.append(log)
        if on_turn is not None:
            on_turn(log, log.turn, total)

    def _state_json(self, sim: ResilientCitySim, tokens_remaining: int) -> str:
        return json.dumps(
            sim.state_view(tokens_remaining), sort_keys=True, separators=(",", ":")
        )

    def _parse_action(self, text: str) -> AgentAction | None:
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        try:
            action = AgentAction.from_untrusted(data)
        except InvalidActionError:
            return None
        return action

    def _record_skip(  # noqa: PLR0913 -- skip log needs loop context: fired plan entry, scored tokens, hook + total.
        self,
        sim: ResilientCitySim,
        result: MatchResult,
        state_hash: str,
        reason: str,
        fired: str | None,
        scored_tokens: int,
        on_turn: Callable[[TurnLog, int, int], None] | None,
        total: int,
    ) -> None:
        sim.step(None)
        running = full_scores(sim, scored_tokens)
        self._record_turn(
            result,
            TurnLog(
                turn=sim.turn,
                state_hash=state_hash,
                action=None,
                skip_reason=reason,
                tokens_used=0,
                spend=0,
                intervention=fired,
                impact=running["impact"],
                efficiency=running["efficiency"],
            ),
            on_turn,
            total,
        )
