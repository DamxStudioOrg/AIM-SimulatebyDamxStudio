"""API adapter tests. Require the `api` extra; skipped without it."""

from __future__ import annotations

import json
import os
import sys
import types
import typing
import unittest
from contextlib import ExitStack
from typing import TYPE_CHECKING
from unittest import mock

from tests.support import balanced_json

if TYPE_CHECKING:
    from aim_sim.models import ProviderCompletion

try:
    import fastapi  # noqa: F401
    import pydantic  # noqa: F401

    from aim_sim.api import create_app

    HAS_API = True
except ImportError:
    HAS_API = False


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class ApiTest(unittest.TestCase):
    """Contract and match endpoints serve the documented shapes."""

    def _scripted(self, outputs: list[str]) -> ExitStack:
        """Serve one scripted model id with canned outputs, no network."""
        from aim_sim.runner import ScriptedProvider

        stack = ExitStack()
        stack.enter_context(
            mock.patch("aim_sim.api.enabled_models", return_value=["local/test-model"])
        )
        stack.enter_context(
            mock.patch(
                "aim_sim.api.provider_for_model",
                return_value=ScriptedProvider(outputs),
            )
        )
        return stack

    def test_contract_reports_enforced_limits(self) -> None:
        with mock.patch("aim_sim.api.detect_local_models", return_value=[]):
            contract = self._call("/contract")
        self.assertEqual(contract["sim_version"], "0.1.0")
        self.assertEqual(contract["turns"], 12)
        self.assertEqual(contract["prompt_max_words"], 250)
        self.assertEqual(contract["token_budget"], 15000)

    def test_contract_lists_detected_before_configured(self) -> None:
        from aim_sim.runner import META_DEFAULT_MODELS

        with (
            mock.patch(
                "aim_sim.api.detect_local_models",
                return_value=["ollama/llama3.1"],
            ),
            mock.patch.dict(os.environ, {"SIM_MODELS": "gpt-4o-mini"}),
        ):
            contract = self._call("/contract")
        models = contract["models"]
        self.assertEqual(
            models,
            [
                {"id": "ollama/llama3.1", "kind": "local"},
                *({"id": model, "kind": "hosted"} for model in META_DEFAULT_MODELS),
                {"id": "gpt-4o-mini", "kind": "hosted"},
            ],
        )

    def test_post_match_over_http(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        self.assertEqual(body["seed"], 3)
        self.assertIn("impact", body["scores"])

    def test_stream_emits_turns_then_result(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/stream",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        events = [
            json.loads(line[len("data: ") :])
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        turns = [event for event in events if event["type"] == "turn"]
        results = [event for event in events if event["type"] == "result"]
        self.assertEqual(len(turns), 12)
        self.assertEqual([turn["turn"] for turn in turns], list(range(1, 13)))
        self.assertTrue(all(turn["total"] == 12 for turn in turns))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["result"]["seed"], 3)
        self.assertIn("impact", results[0]["result"]["scores"])

    def test_match_payload_reports_thinking(self) -> None:
        from aim_sim.models import ProviderCompletion
        from aim_sim.runner import ScriptedProvider

        class ThinkingStub(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=balanced_json(),
                    prompt_tokens=100,
                    completion_tokens=120,
                    reasoning_tokens=60,
                )

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["local/test-model"]),
            mock.patch(
                "aim_sim.api.provider_for_model",
                return_value=ThinkingStub([balanced_json()]),
            ),
        ):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="local/test-model",
            )
        turns = typing.cast("list[dict[str, typing.Any]]", out["turns"])
        self.assertTrue(all(turn["thinking_tokens"] == 60 for turn in turns))
        totals = typing.cast("dict[str, typing.Any]", out["totals"])
        self.assertEqual(totals["thinking_tokens"], 60 * 12.0)

    def test_stream_turn_event_reports_thinking(self) -> None:
        from fastapi.testclient import TestClient

        from aim_sim.api import create_app
        from aim_sim.models import ProviderCompletion
        from aim_sim.runner import ScriptedProvider

        class ThinkingStub(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=balanced_json(),
                    prompt_tokens=100,
                    completion_tokens=120,
                    reasoning_tokens=60,
                )

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["local/test-model"]),
            mock.patch(
                "aim_sim.api.provider_for_model",
                return_value=ThinkingStub([balanced_json()]),
            ),
        ):
            response = TestClient(create_app()).post(
                "/matches/stream",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                },
            )
        events = [
            json.loads(line[len("data: ") :])
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        turns = [event for event in events if event["type"] == "turn"]
        self.assertEqual(len(turns), 12)
        self.assertTrue(all(turn["thinking_tokens"] == 60 for turn in turns))

    def test_stream_rejects_unknown_model_up_front(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/stream",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/nope",
                },
            )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("text/event-stream", response.headers["content-type"])

    def test_browser_preflight_gets_cors_and_private_network(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(create_app())
        response = client.options(
            "/matches/run",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"], "http://localhost:3000"
        )
        self.assertEqual(
            response.headers["access-control-allow-private-network"], "true"
        )

    def test_compute_endpoints_gate_on_sim_token(self) -> None:
        from fastapi.testclient import TestClient

        payload = {
            "prompt": "Hold reserves.",
            "seed": 3,
            "model": "local/test-model",
        }
        with (
            mock.patch.dict(os.environ, {"SIM_API_TOKEN": "s3cret"}),
            self._scripted([balanced_json()]),
        ):
            client = TestClient(create_app())
            denied = client.post("/matches/run", json=payload)
            wrong = client.post(
                "/matches/run", json=payload, headers={"x-sim-token": "nope"}
            )
            allowed = client.post(
                "/matches/run", json=payload, headers={"x-sim-token": "s3cret"}
            )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["detail"]["error"], "forbidden")
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(allowed.status_code, 200)

    def test_open_sim_token_leaves_compute_open(self) -> None:
        from fastapi.testclient import TestClient

        saved = os.environ.pop("SIM_API_TOKEN", None)
        try:
            with self._scripted([balanced_json()]):
                response = TestClient(create_app()).post(
                    "/matches/run",
                    json={
                        "prompt": "Hold reserves.",
                        "seed": 3,
                        "model": "local/test-model",
                    },
                )
        finally:
            if saved is not None:
                os.environ["SIM_API_TOKEN"] = saved
        self.assertEqual(response.status_code, 200)

    def test_per_run_word_cap_is_enforced(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "One two three four five.",
                    "seed": 3,
                    "model": "local/test-model",
                    "prompt_max_words": 2,
                },
            )
        self.assertEqual(response.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", response.json())
        self.assertEqual(detail["detail"]["error"], "prompt_too_long")

    def test_per_run_token_budget_truncates(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                    "token_budget": 100,
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        reasons = [turn["skip_reason"] for turn in body["turns"]]
        self.assertIn("budget_exhausted", reasons)

    def test_per_run_turn_cap_truncates(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                    "turn_token_cap": 1,
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        reasons = [turn["skip_reason"] for turn in body["turns"]]
        self.assertIn("turn_token_cap", reasons)

    def test_non_positive_limits_are_rejected(self) -> None:
        from fastapi.testclient import TestClient

        cases = ({"token_budget": 0}, {"prompt_max_words": -5}, {"turn_token_cap": 0})
        for payload in cases:
            with self.subTest(payload=payload):
                with self._scripted([balanced_json()]):
                    response = TestClient(create_app()).post(
                        "/matches/run",
                        json={
                            "prompt": "Hold reserves.",
                            "seed": 3,
                            "model": "local/test-model",
                            **payload,
                        },
                    )
                self.assertEqual(response.status_code, 422)
                detail = typing.cast("dict[str, typing.Any]", response.json())
                self.assertEqual(detail["detail"]["error"], "bad_limits")

    def test_post_tote_over_http(self) -> None:
        import json as jsonlib

        from fastapi.testclient import TestClient

        from aim_sim.tote import offered_catalog

        offer = list(offered_catalog(4))
        with self._scripted([jsonlib.dumps({"packing": offer})]):
            response = TestClient(create_app()).post(
                "/tote/pack",
                json={
                    "prompt": "Heavies at the bottom.",
                    "seed": 4,
                    "model": "local/test-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        self.assertIsNone(body["invalid_reason"])
        self.assertEqual(body["packing"], offer)

    def test_unknown_model_is_rejected(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["ollama/llama3.1"]),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call("/matches/run", prompt="Hold reserves.", seed=3, model="nope")
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "unknown_model")
        self.assertEqual(detail["available"], ["ollama/llama3.1"])

    def test_missing_llm_extra_is_501(self) -> None:
        from fastapi import HTTPException

        keyed = types.SimpleNamespace(headers={"x-provider-key": "user-key"})
        with (
            mock.patch("aim_sim.api.detect_local_models", return_value=[]),
            mock.patch.dict(os.environ, {"SIM_MODELS": "gpt-4o-mini"}),
            mock.patch.dict(sys.modules, {"litellm": None}),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="gpt-4o-mini",
                request=keyed,
            )
        self.assertEqual(ctx.exception.status_code, 501)

    def test_unreachable_local_runtime_is_502(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.detect_local_models", return_value=[]),
            mock.patch.dict(
                os.environ,
                {
                    "SIM_MODELS": "ollama/llama3.1",
                    "OLLAMA_HOST": "http://127.0.0.1:9",
                },
            ),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/matches/run",
                prompt="Hold reserves and fund clinics early.",
                seed=3,
                model="ollama/llama3.1",
            )
        self.assertEqual(ctx.exception.status_code, 502)

    def test_502_names_an_unreachable_runtime(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.detect_local_models", return_value=[]),
            mock.patch.dict(
                os.environ,
                {
                    "SIM_MODELS": "ollama/llama3.1",
                    "OLLAMA_HOST": "http://127.0.0.1:9",
                },
            ),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/matches/run",
                prompt="Hold reserves and fund clinics early.",
                seed=3,
                model="ollama/llama3.1",
            )
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail, {"error": "provider_failed", "reason": "unreachable"})

    def test_stream_error_frame_names_the_cause(self) -> None:
        from fastapi.testclient import TestClient

        from aim_sim.api import create_app
        from aim_sim.runner import MockProvider

        class UnreachableProvider(MockProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                msg = "local model host unreachable: refused"
                raise RuntimeError(msg)

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["local/test-model"]),
            mock.patch(
                "aim_sim.api.provider_for_model",
                return_value=UnreachableProvider(),
            ),
        ):
            response = TestClient(create_app()).post(
                "/matches/stream",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        events = [
            json.loads(line[len("data: ") :])
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        errors = [event for event in events if event["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["error"], "provider_failed")
        self.assertEqual(errors[0]["reason"], "unreachable")

    def test_match_turns_carry_actions(self) -> None:
        with self._scripted([balanced_json()]):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves and fund clinics early.",
                seed=3,
            )
        turns = out["turns"]
        self.assertIsInstance(turns, list)
        self.assertEqual(len(turns), 12)
        first = turns[0]
        self.assertIsNone(first["skip_reason"])
        self.assertEqual(first["policies"], [])
        allocation = first["allocation"]
        self.assertAlmostEqual(sum(allocation.values()), 100.0)
        self.assertEqual(allocation["rescue"], 12.0)

    def test_match_response_carries_badges_strategy_and_audit(self) -> None:
        with self._scripted([balanced_json()]):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves and fund clinics early.",
                seed=3,
            )
        self.assertIsInstance(out["badges"], list)
        self.assertIn("mean_allocation", out["strategy"])
        self.assertEqual(out["prompt_words"], 6)
        self.assertEqual(out["token_budget"], 15000)
        self.assertIn("usage_anomalies", out["totals"])
        self.assertFalse(out["turns"][0]["usage_anomaly"])

    def test_oversized_history_is_rejected(self) -> None:
        from fastapi import HTTPException

        with self._scripted([balanced_json()]), self.assertRaises(HTTPException) as ctx:
            self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                prior_games=["a", "b", "c", "d"],
            )
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "bad_history")

    def test_match_echoes_chaos_level(self) -> None:
        with self._scripted([balanced_json()]):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                chaos_level=0.5,
            )
        self.assertEqual(out["chaos_level"], 0.5)

    def test_out_of_range_chaos_is_rejected(self) -> None:
        from fastapi import HTTPException

        for level in (-1.0, 1.5):
            with (
                self._scripted([balanced_json()]),
                self.assertRaises(HTTPException) as ctx,
            ):
                self._call(
                    "/matches/run",
                    prompt="Hold reserves.",
                    seed=3,
                    chaos_level=level,
                )
            self.assertEqual(ctx.exception.status_code, 422)
            detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
            self.assertEqual(detail["error"], "bad_chaos_level")

    def test_match_with_field_plan_records_interventions(self) -> None:
        with self._scripted([balanced_json()]):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                interventions=[{"turn": 5, "kind": "irrigate"}],
            )
        turns = typing.cast("list[dict[str, typing.Any]]", out["turns"])
        self.assertEqual(turns[4]["intervention"], "irrigate")
        self.assertTrue(all(turn["intervention"] is None for turn in turns[:4]))
        totals = typing.cast("dict[str, typing.Any]", out["totals"])
        self.assertEqual(totals["interventions_used"], 1.0)
        for turn in turns:
            self.assertIn("impact", turn)
            self.assertIn("efficiency", turn)

    def test_asset_draft_returns_validated_params(self) -> None:
        import json

        from aim_sim.assets import validate_assets

        params = {
            "version": 1,
            "palette": {
                "moon": "moon",
                "crater": "crater",
                "accent": "brand",
                "crane": "gold",
            },
            "scenery": {
                "trees": 12,
                "clouds": 4,
                "beacons": 6,
                "pennants": 10,
                "shrooms": 5,
            },
            "moon": {"craters": 14, "size": 1.0},
            "towers": {"heightScale": 1.0},
        }
        with self._scripted([json.dumps(params)]):
            out = self._call(
                "/assets/draft",
                prompt="An ember moon over a clinic grove.",
                seed=3,
            )
        self.assertEqual(out["params"], validate_assets(params))
        self.assertGreater(out["tokens_used"], 0)

    def test_asset_draft_rejects_model_garbage(self) -> None:
        from fastapi import HTTPException

        for output in ("not json at all", '{"version": 2}'):
            with self.subTest(output=output):
                with self._scripted([output]), self.assertRaises(HTTPException) as ctx:
                    self._call("/assets/draft", prompt="A calm moon.", seed=3)
                self.assertEqual(ctx.exception.status_code, 422)
                detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
                self.assertEqual(detail["error"], "invalid_draft")

    def test_asset_draft_needs_own_key_on_hosted(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["gpt-4o-mini"]),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/assets/draft",
                prompt="A calm moon.",
                seed=3,
                model="gpt-4o-mini",
            )
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "missing_key")

    def test_asset_draft_rejects_overlong_prompt(self) -> None:
        from fastapi import HTTPException

        with (
            self._scripted(['{"version": 1}']),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call("/assets/draft", prompt="x" * 2001, seed=3)
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "bad_draft")

    def test_asset_draft_gates_on_sim_token(self) -> None:
        from fastapi.testclient import TestClient

        with (
            mock.patch.dict(os.environ, {"SIM_API_TOKEN": "s3cret"}),
            self._scripted(['{"version": 1}']),
        ):
            denied = TestClient(create_app()).post(
                "/assets/draft",
                json={"prompt": "A calm moon.", "model": "local/test-model"},
            )
        self.assertEqual(denied.status_code, 403)

    def test_prompt_judge_returns_validated_verdict(self) -> None:
        reply = json.dumps(
            {
                "clarity": 7,
                "specificity": 4.6,
                "contingency": 12,
                "economy": -2,
                "advice": ["Name the split in percentages.", "x" * 300, 42, ""],
                "providerKey": "sk-nope",
            }
        )
        with self._scripted([reply]):
            out = self._call(
                "/prompt/judge", prompt="Fund housing. Run seed 11: impact 51."
            )
        verdict = typing.cast("dict[str, typing.Any]", out["verdict"])
        self.assertEqual(
            verdict["scores"],
            {"clarity": 7, "specificity": 5, "contingency": 10, "economy": 0},
        )
        self.assertEqual(len(verdict["advice"]), 2)
        self.assertNotIn("providerKey", verdict)
        self.assertGreater(out["tokens_used"], 0)

    def test_prompt_judge_rejects_model_garbage(self) -> None:
        from fastapi import HTTPException

        for output in (
            "not json at all",
            '{"clarity": 5}',
            '{"clarity": "hi", "specificity": 1, "contingency": 1, "economy": 1}',
        ):
            with self.subTest(output=output):
                with (
                    self._scripted([output]),
                    self.assertRaises(HTTPException) as ctx,
                ):
                    self._call("/prompt/judge", prompt="Fund housing.")
                self.assertEqual(ctx.exception.status_code, 422)
                detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
                self.assertEqual(detail["error"], "invalid_judge")

    def test_prompt_judge_rejects_overlong_prompt(self) -> None:
        from fastapi import HTTPException

        with (
            self._scripted(
                ['{"clarity": 1, "specificity": 1, "contingency": 1, "economy": 1}']
            ),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call("/prompt/judge", prompt="x" * 8001)
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "bad_judge")

    def test_bad_field_plan_is_rejected(self) -> None:
        from fastapi import HTTPException

        with self._scripted([balanced_json()]), self.assertRaises(HTTPException) as ctx:
            self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                interventions=[
                    {"turn": 5, "kind": "irrigate"},
                    {"turn": 5, "kind": "terrace"},
                ],
            )
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "bad_interventions")

    def test_tote_response_carries_badges_and_audit(self) -> None:
        import json as jsonlib

        from fastapi.testclient import TestClient

        from aim_sim.tote import offered_catalog

        offer = list(offered_catalog(4))
        with self._scripted([jsonlib.dumps({"packing": offer})]):
            response = TestClient(create_app()).post(
                "/tote/pack",
                json={
                    "prompt": "Heavies at the bottom.",
                    "seed": 4,
                    "model": "local/test-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        self.assertIsInstance(body["badges"], list)
        self.assertGreaterEqual(body["bonus"], 0.0)
        self.assertEqual(len(body["scarce"]), 2)
        self.assertFalse(body["usage_anomaly"])

    def test_tote_token_budget_is_enforced(self) -> None:
        import json as jsonlib

        from fastapi.testclient import TestClient

        from aim_sim.tote import offered_catalog

        offer = list(offered_catalog(4))
        with self._scripted([jsonlib.dumps({"packing": offer})]):
            response = TestClient(create_app()).post(
                "/tote/pack",
                json={
                    "prompt": "Heavies at the bottom.",
                    "seed": 4,
                    "model": "local/test-model",
                    "token_budget": 1,
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        self.assertEqual(body["invalid_reason"], "token_budget_exceeded")

    def _call(self, path: str, **kwargs: object) -> dict[str, typing.Any]:
        app: typing.Any = create_app()
        matches = [r for r in app.routes if getattr(r, "path", "") == path]
        self.assertEqual(len(matches), 1)
        endpoint: typing.Any = matches[0].endpoint
        if path in ("/matches/run", "/assets/draft", "/prompt/judge"):
            kwargs.setdefault("model", "local/test-model")
        request = kwargs.pop("request", None)
        body: typing.Any = types.SimpleNamespace(**kwargs) if kwargs else None
        stub: typing.Any = request if request is not None else types.SimpleNamespace()
        out: typing.Any = (
            endpoint() if body is None else endpoint(body=body, request=stub)
        )
        if not isinstance(out, dict):
            self.fail("match endpoint must return a dict")
        return out

    def test_bad_challenge_params_is_rejected(self) -> None:
        from aim_sim.api import RunRequest, _GateError, _validate_challenge_params

        # Oversized payload
        big = {"kind": "city", "id": "x" * 50000}
        body = RunRequest(prompt="go", challenge_params=big)
        with self.assertRaises(_GateError) as ctx:
            _validate_challenge_params(body)
        self.assertEqual(ctx.exception.code, "bad_challenge_params")

        # Disallowed key
        body2 = RunRequest(prompt="go", challenge_params={"evil_key": 1})
        with self.assertRaises(_GateError):
            _validate_challenge_params(body2)

    def test_over_cap_limits_are_rejected(self) -> None:
        from fastapi.testclient import TestClient

        cases = (
            {"token_budget": 2_000_000},
            {"prompt_max_words": 60_000},
            {"turn_token_cap": 1_000_000},
            {"challenge_params": {"kind": "city", "id": "t", "turns": 13}},
        )
        for payload in cases:
            with self.subTest(payload=payload):
                with self._scripted([balanced_json()]):
                    response = TestClient(create_app()).post(
                        "/matches/run",
                        json={
                            "prompt": "Hold reserves.",
                            "seed": 3,
                            "model": "local/test-model",
                            **payload,
                        },
                    )
                self.assertEqual(response.status_code, 422)
                detail = typing.cast("dict[str, typing.Any]", response.json())
                self.assertEqual(detail["detail"]["error"], "bad_limits")

    def test_short_season_still_plays(self) -> None:
        from fastapi.testclient import TestClient

        with self._scripted([balanced_json()]):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                    "challenge_params": {"kind": "city", "id": "t", "turns": 4},
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        self.assertEqual(len(body["turns"]), 4)

    def test_deeply_nested_params_are_rejected(self) -> None:
        from aim_sim.api import RunRequest, _GateError, _validate_challenge_params

        deep: dict[str, object] = {}
        cursor = deep
        for _ in range(20000):
            child: dict[str, object] = {}
            cursor["x"] = child
            cursor = child
        body = RunRequest(prompt="go", challenge_params={"dressing": deep})
        with self.assertRaises(_GateError) as ctx:
            _validate_challenge_params(body)
        self.assertEqual(ctx.exception.code, "bad_challenge_params")


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class RateLimitTest(unittest.IsolatedAsyncioTestCase):
    """Buckets key on the direct peer and stay bounded."""

    def setUp(self) -> None:
        from aim_sim.api import _reset_rate_limit

        _reset_rate_limit()

    def tearDown(self) -> None:
        from aim_sim.api import _reset_rate_limit

        _reset_rate_limit()

    async def _hit(self, host: str, headers: dict[str, str] | None = None) -> int:
        from fastapi import Request, Response

        from aim_sim.api import _rate_limit

        request: typing.Any = types.SimpleNamespace(
            headers=headers or {}, client=types.SimpleNamespace(host=host)
        )

        async def call_next(_request: Request) -> Response:
            return Response("ok")

        response = await _rate_limit(request, call_next)
        return int(response.status_code)

    async def test_allows_a_burst_then_throttles(self) -> None:
        for _ in range(120):
            self.assertEqual(await self._hit("9.9.9.9"), 200)
        self.assertEqual(await self._hit("9.9.9.9"), 429)

    async def test_forwarded_headers_do_not_mint_identity(self) -> None:
        for index in range(121):
            headers = {"x-forwarded-for": f"10.0.0.{index % 250 + 1}"}
            code = await self._hit("9.9.9.9", headers)
            self.assertEqual(code, 200 if index < 120 else 429)

    async def test_stale_buckets_are_pruned(self) -> None:
        import time as time_module

        from aim_sim.api import _RATE_LIMIT_MAX_CLIENTS, _rate_limit_store

        old = time_module.time() - 3600.0
        for index in range(_RATE_LIMIT_MAX_CLIENTS + 10):
            _rate_limit_store[f"stale-{index}"] = (1, old)
        self.assertEqual(await self._hit("9.9.9.9"), 200)
        self.assertLessEqual(len(_rate_limit_store), 2)


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class BodySizeLimitTest(unittest.IsolatedAsyncioTestCase):
    """Bodies are measured in bytes, not trusted headers."""

    async def test_chunked_body_without_length_is_still_capped(self) -> None:
        from fastapi import Request, Response

        from aim_sim.api import _BODY_MAX_BYTES, _body_size_limit

        big = b"x" * (_BODY_MAX_BYTES + 1)

        async def huge_body() -> bytes:
            return big

        request: typing.Any = types.SimpleNamespace(headers={}, body=huge_body)

        async def call_next(_request: Request) -> Response:
            return Response("ok")

        response = await _body_size_limit(request, call_next)
        self.assertEqual(response.status_code, 413)

    async def test_small_body_passes_through(self) -> None:
        from fastapi import Request, Response

        from aim_sim.api import _body_size_limit

        async def small_body() -> bytes:
            return b'{"prompt": "go"}'

        request: typing.Any = types.SimpleNamespace(headers={}, body=small_body)

        async def call_next(_request: Request) -> Response:
            return Response("ok")

        response = await _body_size_limit(request, call_next)
        self.assertEqual(response.status_code, 200)


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class PrivateNetworkTest(unittest.TestCase):
    """The private-network grant rides allowlisted origins only."""

    def test_allowlisted_origin_gets_the_grant(self) -> None:
        from fastapi.testclient import TestClient

        response = TestClient(create_app()).get(
            "/contract", headers={"origin": "http://localhost:3000"}
        )
        self.assertEqual(
            response.headers.get("access-control-allow-private-network"), "true"
        )

    def test_foreign_or_missing_origin_gets_nothing(self) -> None:
        from fastapi.testclient import TestClient

        response = TestClient(create_app()).get(
            "/contract", headers={"origin": "https://evil.example"}
        )
        self.assertIsNone(response.headers.get("access-control-allow-private-network"))
        bare = TestClient(create_app()).get("/contract")
        self.assertIsNone(bare.headers.get("access-control-allow-private-network"))


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class StreamSlotTest(unittest.TestCase):
    """A full stream house answers 503 instead of starving threads."""

    def test_full_house_answers_busy(self) -> None:
        from fastapi.testclient import TestClient

        from aim_sim.api import _STREAM_SLOTS, _stream_slots

        held = [_stream_slots.acquire(blocking=False) for _ in range(_STREAM_SLOTS)]
        self.assertTrue(all(held))
        try:
            with mock.patch(
                "aim_sim.api.enabled_models", return_value=["local/test-model"]
            ):
                response = TestClient(create_app()).post(
                    "/matches/stream",
                    json={
                        "prompt": "Hold reserves.",
                        "seed": 3,
                        "model": "local/test-model",
                    },
                )
        finally:
            for _ in held:
                _stream_slots.release()
        self.assertEqual(response.status_code, 503)
        detail = typing.cast("dict[str, typing.Any]", response.json())
        self.assertEqual(detail["detail"]["error"], "busy")


@unittest.skipUnless(HAS_API, "sim api extra is not installed")
class ModelCacheTest(unittest.TestCase):
    """Detection probes run once per fingerprint, not per request."""

    def tearDown(self) -> None:
        from aim_sim.api import _reset_model_cache

        _reset_model_cache()

    def test_detection_runs_once_across_calls(self) -> None:
        from aim_sim.api import _reset_model_cache, enabled_models

        _reset_model_cache()
        with (
            mock.patch.dict(os.environ, {"SIM_MODELS": "cache-probe-model"}),
            mock.patch(
                "aim_sim.api.detect_local_models", return_value=["ollama/x"]
            ) as detected,
            mock.patch("aim_sim.api.bionic_models", return_value=[]),
        ):
            first = enabled_models()
            second = enabled_models()
        self.assertEqual(detected.call_count, 1)
        self.assertEqual(first, second)
        self.assertIn("cache-probe-model", first)
