"""BYOK + error-hygiene tests. Same unittest style as the other sim suits."""

from __future__ import annotations

import os
import typing
import unittest
from contextlib import ExitStack
from unittest import mock

from aim_sim.api import create_app, key_env_for
from tests.support import balanced_json


def _scripted_model(outputs: list[str]) -> ExitStack:
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


class KeyEnvTest(unittest.TestCase):
    """Model ids resolve to exactly one key slot, or none."""

    def test_openai_models_map_to_openai_key(self) -> None:
        self.assertEqual(key_env_for("gpt-4o-mini"), "OPENAI_API_KEY")
        self.assertEqual(key_env_for("openai/gpt-4o"), "OPENAI_API_KEY")

    def test_anthropic_models_map_to_anthropic_key(self) -> None:
        self.assertEqual(
            key_env_for("anthropic/claude-3-5-sonnet"), "ANTHROPIC_API_KEY"
        )
        self.assertEqual(key_env_for("claude-3-haiku"), "ANTHROPIC_API_KEY")

    def test_baseten_models_map_to_baseten_key(self) -> None:
        self.assertEqual(
            key_env_for("baseten/meta-llama-Llama-3-1-8B"), "BASETEN_API_KEY"
        )

    def test_provider_prefix_derives_key_slot(self) -> None:
        self.assertEqual(key_env_for("gemini/gemini-2.0-flash"), "GEMINI_API_KEY")

    def test_meta_models_use_the_meta_token_slot(self) -> None:
        from aim_sim.runner import META_API_KEY_ENV

        self.assertEqual(key_env_for("meta/Llama-4-Scout"), META_API_KEY_ENV)

    def test_local_models_need_no_key(self) -> None:
        self.assertIsNone(key_env_for("ollama/llama3.1"))
        self.assertIsNone(key_env_for("local/hermes3"))

    def test_unknown_prefix_resolves_to_no_slot(self) -> None:
        self.assertIsNone(key_env_for("mistral/mistral-large"))
        self.assertIsNone(key_env_for("acme-gizmo-1"))

    def test_unknown_prefix_is_rejected_up_front(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch(
                "aim_sim.api.enabled_models", return_value=["mistral/mistral-large"]
            ),
            self.assertRaises(HTTPException) as ctx,
        ):
            _call_endpoint(
                self,
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="mistral/mistral-large",
                request=_request("user-key"),
            )
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "unsupported_model_keys")


class ByokEndpointTest(unittest.TestCase):
    """Browser runs on hosted models require the user's own key."""

    def _call(self, path: str, **kwargs: object) -> dict[str, typing.Any]:
        return _call_endpoint(self, path, **kwargs)

    def test_hosted_model_without_user_key_is_rejected(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["gpt-4o-mini"]),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/matches/run", prompt="Hold reserves.", seed=3, model="gpt-4o-mini"
            )
        self.assertEqual(ctx.exception.status_code, 422)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail["error"], "missing_key")

    def test_hosted_model_user_key_reaches_provider_constructor(self) -> None:
        from aim_sim.runner import ScriptedProvider

        seen: dict[str, object] = {}

        def factory(model: str, api_key: object = None) -> object:
            seen["model"] = model
            seen["key"] = api_key
            return ScriptedProvider([balanced_json()])

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["gpt-4o-mini"]),
            mock.patch("aim_sim.api.provider_for_model", side_effect=factory),
        ):
            os.environ.pop("OPENAI_API_KEY", None)
            out = self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="gpt-4o-mini",
                request=_request("sk-user-key"),
            )
        self.assertEqual(seen, {"model": "gpt-4o-mini", "key": "sk-user-key"})
        self.assertEqual(out["provider"], "scripted-test")
        # The key rides the constructor now: process env stays clean.
        self.assertNotIn("OPENAI_API_KEY", os.environ)

    def test_provider_failure_hides_details(self) -> None:
        from fastapi import HTTPException

        message = "boom sk-SECRET-abc123 blew up"

        class ExplodingProvider:
            @property
            def name(self) -> str:
                return "boom"

            def complete(self, _system_prompt: str, _state_json: str) -> object:
                raise RuntimeError(message)

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["gpt-4o-mini"]),
            mock.patch(
                "aim_sim.api.provider_for_model",
                lambda _model, _key=None: ExplodingProvider(),
            ),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="gpt-4o-mini",
                request=_request("sk-SECRET-abc123"),
            )
        self.assertEqual(ctx.exception.status_code, 502)
        detail = typing.cast("dict[str, typing.Any]", ctx.exception.detail)
        self.assertEqual(detail, {"error": "provider_failed"})
        self.assertNotIn("sk-SECRET", str(detail))

    def test_uid_is_echoed_and_bounded(self) -> None:
        from fastapi import HTTPException

        with _scripted_model([balanced_json()]):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves and fund clinics early.",
                seed=3,
                uid="123e4567-e89b-12d3-a456-426614174000",
            )
            self.assertEqual(out["uid"], "123e4567-e89b-12d3-a456-426614174000")
            with self.assertRaises(HTTPException) as ctx:
                self._call(
                    "/matches/run", prompt="Hold reserves.", seed=3, uid="x" * 129
                )
        self.assertEqual(ctx.exception.status_code, 422)


def _call_endpoint(
    test: unittest.TestCase, path: str, **kwargs: object
) -> dict[str, typing.Any]:
    """Invoke one API route function directly with a namespace body."""
    app: typing.Any = create_app()
    matches = [r for r in app.routes if getattr(r, "path", "") == path]
    test.assertEqual(len(matches), 1)
    endpoint: typing.Any = matches[0].endpoint
    request = kwargs.pop("request", None)
    kwargs.setdefault("model", "local/test-model")
    import types

    body: typing.Any = types.SimpleNamespace(**kwargs)
    stub: typing.Any = (
        request if request is not None else types.SimpleNamespace(headers=_Headers({}))
    )
    out: typing.Any = endpoint(body=body, request=stub)
    if not isinstance(out, dict):
        test.fail("match endpoint must return a dict")
    return typing.cast("dict[str, typing.Any]", out)


class ToteEndpointTest(unittest.TestCase):
    """The tote endpoint validates, scores, and gates like matches."""

    def test_valid_packing_scores(self) -> None:
        import json

        from aim_sim.tote import offered_catalog

        offer = offered_catalog(4)
        with _scripted_model([json.dumps({"packing": list(offer[:4])})]):
            out = self._call("/tote/pack", prompt="Heavies bottom.", seed=4)
        self.assertGreater(out["score"], 0.0)
        self.assertEqual(out["packing"], list(offer[:4]))
        self.assertEqual(len(out["offered"]), 10)

    def test_local_model_runs_without_key(self) -> None:
        from aim_sim.runner import ScriptedProvider

        scripted = ScriptedProvider([balanced_json()])
        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["ollama/llama3.1"]),
            mock.patch("aim_sim.api.provider_for_model", return_value=scripted),
        ):
            out = self._call(
                "/matches/run",
                prompt="Hold reserves.",
                seed=3,
                model="ollama/llama3.1",
            )
        self.assertEqual(len(out["turns"]), 12)

    def test_offer_draw_is_seeded(self) -> None:
        from aim_sim.tote import offered_catalog

        app: typing.Any = create_app()
        matches = [r for r in app.routes if getattr(r, "path", "") == "/tote/offer"]
        self.assertEqual(len(matches), 1)
        out = typing.cast("dict[str, typing.Any]", matches[0].endpoint(seed=4))
        self.assertEqual(out["offered"], list(offered_catalog(4)))

    def test_catalog_lists_items_with_weights(self) -> None:
        app: typing.Any = create_app()
        matches = [r for r in app.routes if getattr(r, "path", "") == "/tote/catalog"]
        self.assertEqual(len(matches), 1)
        out = typing.cast("dict[str, typing.Any]", matches[0].endpoint())
        self.assertEqual(out["capacity_kg"], 10.0)
        by_id = {item["id"]: item for item in out["items"]}
        self.assertEqual(len(by_id), 24)
        self.assertEqual(by_id["hammer"]["weight"], 1.2)
        self.assertIn("sharp", by_id["saw"]["tags"])
        self.assertTrue(by_id["eggs"]["fragile"])

    def test_hosted_tote_without_key_is_rejected(self) -> None:
        from fastapi import HTTPException

        with (
            mock.patch("aim_sim.api.enabled_models", return_value=["gpt-4o-mini"]),
            self.assertRaises(HTTPException) as ctx,
        ):
            self._call("/tote/pack", prompt="Pack wisely.", seed=4, model="gpt-4o-mini")
        self.assertEqual(ctx.exception.status_code, 422)

    def _call(self, path: str, **kwargs: object) -> dict[str, typing.Any]:
        app: typing.Any = create_app()
        matches = [r for r in app.routes if getattr(r, "path", "") == path]
        self.assertEqual(len(matches), 1)
        endpoint: typing.Any = matches[0].endpoint
        request = kwargs.pop("request", None)
        kwargs.setdefault("model", "local/test-model")
        import types

        body: typing.Any = types.SimpleNamespace(**kwargs)
        stub: typing.Any = (
            request
            if request is not None
            else types.SimpleNamespace(headers=_Headers({}))
        )
        out: typing.Any = endpoint(body=body, request=stub)
        if not isinstance(out, dict):
            self.fail("match endpoint must return a dict")
        return typing.cast("dict[str, typing.Any]", out)


class _Headers:
    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, name: str, default: object = None) -> object:
        return self._values.get(name.lower(), default)


def _request(key: str) -> object:
    import types

    return types.SimpleNamespace(headers=_Headers({"x-provider-key": key}))


class ScrubTest(unittest.TestCase):
    """Failure text never carries key material to logs or clients."""

    def test_env_value_is_redacted_but_slot_name_stays(self) -> None:
        from aim_sim.api import _scrub

        out = _scrub("boom OPENAI_API_KEY=sk-live-123 blew up", None)
        self.assertNotIn("sk-live-123", out)
        self.assertIn("OPENAI_API_KEY=[redacted]", out)

    def test_meta_key_shapes_are_redacted(self) -> None:
        from aim_sim.api import _scrub

        out = _scrub("call LLM_12345_abcdEFGH failed", None)
        self.assertNotIn("LLM_12345_abcdEFGH", out)
        out = _scrub("call LLM|12345|abcdEFGH failed", None)
        self.assertNotIn("LLM|12345|abcdEFGH", out)

    def test_legacy_shapes_and_explicit_secrets_still_redact(self) -> None:
        from aim_sim.api import _scrub

        out = _scrub("boom sk-abcdefghij1234 blew up", None)
        self.assertNotIn("sk-abcdefghij1234", out)
        out = _scrub("custom hunter2-token-here leaked", "hunter2-token-here")
        self.assertNotIn("hunter2-token-here", out)


class LogLineTest(unittest.TestCase):
    """Failure traces collapse to one capped, injection-free log line."""

    def test_newlines_ansi_and_length_are_contained(self) -> None:
        from aim_sim.api import _one_log_line

        out = _one_log_line("first\nsecond\x1b[31mred\x1b[0m " + "x" * 600)
        self.assertNotIn("\n", out)
        self.assertNotIn("\x1b", out)
        self.assertLessEqual(len(out), 500)
        self.assertIn("first second", out)


if __name__ == "__main__":
    unittest.main()
