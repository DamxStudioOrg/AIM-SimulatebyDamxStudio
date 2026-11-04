"""Runner tests: budgets enforced, replays deterministic, garbage contained."""

from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.error
from typing import Any
from unittest import mock

from aim_sim.models import (
    InvalidActionError,
    MatchConfig,
    ProviderCompletion,
)
from aim_sim.runner import (
    BIONIC_API_KEY_ENV,
    BIONIC_BASE_URL_ENV,
    CITY_REPLY_SHAPE,
    LOCAL_OPENAI_FALLBACK_URLS,
    META_API_KEY_ENV,
    BionicProvider,
    LiteLLMProvider,
    LocalOpenAIProvider,
    MatchRunner,
    MetaProvider,
    MockProvider,
    OllamaProvider,
    PromptTooLongError,
    RunOptions,
    ScriptedProvider,
    bionic_models,
    detect_local_models,
    local_base_for,
    local_openai_urls,
    meta_api_url,
    ollama_models,
    openai_compat_models,
    provider_for_model,
)
from tests.support import balanced_json


class RunnerTest(unittest.TestCase):
    """The runner plays 12 capped turns and scores the replay."""

    def test_mock_match_completes_within_budget(self) -> None:
        result = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        self.assertEqual(len(result.turns), 12)
        self.assertLessEqual(result.tokens_used, 15_000)
        self.assertIn("impact", result.scores)
        self.assertIn("efficiency", result.scores)
        self.assertTrue(result.loss_reasons)

    def test_same_seed_replays_exactly(self) -> None:
        first = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        second = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        self.assertEqual(first.scores, second.scores)
        self.assertEqual(
            [log.state_hash for log in first.turns],
            [log.state_hash for log in second.turns],
        )

    def test_overlong_prompt_rejected(self) -> None:
        prompt = "word " * 251
        with self.assertRaises(PromptTooLongError):
            MatchRunner().run(prompt, MockProvider(), seed=1)

    def test_prompt_at_cap_accepted(self) -> None:
        prompt = "word " * 250
        result = MatchRunner().run(prompt, MockProvider(), seed=1)
        self.assertEqual(result.prompt_words, 250)

    def test_exhausted_budget_autopasses(self) -> None:
        runner = MatchRunner(MatchConfig(token_budget=1))
        result = runner.run("go", MockProvider(), seed=1)
        self.assertEqual(len(result.turns), 12)
        self.assertIsNone(result.turns[0].skip_reason)
        self.assertEqual(
            [log.skip_reason for log in result.turns[1:]],
            ["budget_exhausted"] * 11,
        )

    def test_invalid_json_becomes_skipped_turns(self) -> None:
        provider = ScriptedProvider(["not json at all"])
        result = MatchRunner().run("go", provider, seed=1)
        self.assertEqual(
            [log.skip_reason for log in result.turns], ["invalid_output"] * 12
        )
        self.assertEqual(result.totals["skipped_turns"], 12.0)
        self.assertIn("impact", result.scores)

    def test_oversize_turn_output_capped(self) -> None:
        provider = ScriptedProvider(["x" * 6000])
        result = MatchRunner().run("go", provider, seed=1)
        self.assertEqual(
            [log.skip_reason for log in result.turns], ["turn_token_cap"] * 12
        )

    def test_scripted_valid_match_uses_canned_moves(self) -> None:
        provider = ScriptedProvider([balanced_json()])
        result = MatchRunner().run("go", provider, seed=5)
        self.assertTrue(all(log.skip_reason is None for log in result.turns))
        self.assertGreater(result.totals["spend"], 0.0)

    def test_provider_receives_reply_shape_suffix(self) -> None:
        seen: list[str] = []

        class CapturingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                seen.append(system_prompt)
                return super().complete(system_prompt, state_json)

        MatchRunner().run("go", CapturingProvider([balanced_json()]), seed=1)
        self.assertEqual(len(seen), 12)
        for prompt in seen:
            self.assertTrue(prompt.startswith("go\n\n"))
            self.assertIn(CITY_REPLY_SHAPE, prompt)

    def test_totals_break_down_deaths_by_cause(self) -> None:
        result = MatchRunner().run("go", MockProvider(), seed=4)
        kinds = ("lives_lost_flood", "lives_lost_heatwave", "lives_lost_infra_failure")
        for key in kinds:
            self.assertIn(key, result.totals)
            self.assertGreaterEqual(result.totals[key], 0.0)
        self.assertAlmostEqual(
            sum(result.totals[key] for key in kinds), result.totals["lives_lost"]
        )


class HistoryTest(unittest.TestCase):
    """Up to three past games ride along; longer histories rejected."""

    def test_history_prefix_reaches_provider(self) -> None:
        seen: list[str] = []

        class CapturingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                seen.append(system_prompt)
                return super().complete(system_prompt, state_json)

        result = MatchRunner().run(
            "go",
            CapturingProvider([balanced_json()]),
            seed=1,
            options=RunOptions(prior_games=("flood then heat", "saved reserves early")),
        )
        self.assertEqual(result.totals["prior_games_used"], 2.0)
        self.assertEqual(len(seen), 12)
        for prompt in seen:
            self.assertIn("Prior games (2, oldest first):", prompt)
            self.assertIn("1. flood then heat", prompt)
            self.assertIn(CITY_REPLY_SHAPE, prompt)

    def test_fourth_game_rejected(self) -> None:
        with self.assertRaises(ValueError):
            MatchRunner().run(
                "go",
                MockProvider(),
                seed=1,
                options=RunOptions(prior_games=("a", "b", "c", "d")),
            )

    def test_overlong_entry_rejected(self) -> None:
        with self.assertRaises(ValueError):
            MatchRunner().run(
                "go",
                MockProvider(),
                seed=1,
                options=RunOptions(prior_games=("word " * 201,)),
            )


class UsageAuditTest(unittest.TestCase):
    """Skewed provider usage flags; honest usage stays clean."""

    def test_mock_match_has_no_anomalies(self) -> None:
        result = MatchRunner().run("go", MockProvider(), seed=1)
        self.assertEqual(result.totals["usage_anomalies"], 0.0)
        self.assertFalse(any(log.usage_anomaly for log in result.turns))

    def test_under_reported_turns_flag_every_turn(self) -> None:
        class QuietProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=balanced_json(), prompt_tokens=1, completion_tokens=1
                )

        result = MatchRunner().run("go", QuietProvider([balanced_json()]), seed=1)
        self.assertEqual(result.totals["usage_anomalies"], 12.0)
        self.assertTrue(all(log.usage_anomaly for log in result.turns))

    def test_result_carries_badges_and_strategy(self) -> None:
        result = MatchRunner().run("go", MockProvider(), seed=1)
        self.assertIsInstance(result.badges, list)
        self.assertIn("mean_allocation", result.strategy)
        self.assertIn("policies", result.strategy)


class ProviderRoutingTest(unittest.TestCase):
    """Model ids route to a local runtime or the hosted gateway."""

    def test_ollama_ids_route_to_ollama(self) -> None:
        provider = provider_for_model("ollama/llama3.1")
        self.assertIsInstance(provider, OllamaProvider)
        self.assertEqual(provider.name, "ollama:llama3.1")

    def test_local_ids_route_to_openai_compat(self) -> None:
        provider = provider_for_model("local/hermes3")
        self.assertIsInstance(provider, LocalOpenAIProvider)
        self.assertEqual(provider.name, "local:hermes3")

    def test_anything_else_routes_to_litellm(self) -> None:
        self.assertIsInstance(provider_for_model("gpt-4o-mini"), LiteLLMProvider)
        self.assertIsInstance(
            provider_for_model("baseten/meta-llama-Llama-3-1-8B"), LiteLLMProvider
        )

    def test_meta_ids_route_to_meta(self) -> None:
        provider = provider_for_model("meta/Llama-4-Scout-17B-16E-Instruct")
        self.assertIsInstance(provider, MetaProvider)
        self.assertEqual(provider.name, "meta:Llama-4-Scout-17B-16E-Instruct")

    def test_local_providers_reject_foreign_ids(self) -> None:
        with self.assertRaises(TypeError):
            OllamaProvider("gpt-4o-mini")
        with self.assertRaises(TypeError):
            LocalOpenAIProvider("ollama/llama3.1")
        with self.assertRaises(TypeError):
            MetaProvider("local/hermes3")


class OllamaProviderTest(unittest.TestCase):
    """The native Ollama chat call parses text plus authoritative usage."""

    def test_complete_returns_text_and_usage(self) -> None:
        payload = {
            "message": {"content": balanced_json()},
            "prompt_eval_count": 41,
            "eval_count": 17,
        }
        with mock.patch("aim_sim.runner._post_json", return_value=payload) as posted:
            completion = OllamaProvider("ollama/llama3.1").complete("go", "{}")
        self.assertEqual(completion.text, balanced_json())
        self.assertEqual(completion.prompt_tokens, 41)
        self.assertEqual(completion.completion_tokens, 17)
        url = posted.call_args.args[0]
        self.assertTrue(url.endswith("/api/chat"))
        payload_sent = posted.call_args.args[1]
        self.assertEqual(payload_sent["options"]["temperature"], 0)

    def test_missing_content_is_an_error(self) -> None:
        with (
            mock.patch("aim_sim.runner._post_json", return_value={"message": {}}),
            self.assertRaises(RuntimeError),
        ):
            OllamaProvider("ollama/llama3.1").complete("go", "{}")

    def test_transport_failure_is_an_error(self) -> None:
        with (
            mock.patch("aim_sim.runner._post_json", side_effect=RuntimeError("down")),
            self.assertRaises(RuntimeError),
        ):
            OllamaProvider("ollama/llama3.1").complete("go", "{}")

    def test_thinking_trace_is_excluded_from_billing(self) -> None:
        from aim_sim.runner import estimate_tokens

        thinking = "consider the districts " * 20
        reply = {
            "message": {"content": balanced_json(), "thinking": thinking},
            "prompt_eval_count": 694,
            "eval_count": 1194,
        }
        with mock.patch("aim_sim.runner._post_json", return_value=reply):
            completion = OllamaProvider("ollama/llama3.1").complete("go", "{}")
        self.assertEqual(completion.reasoning_tokens, estimate_tokens(thinking))
        self.assertEqual(
            completion.game_tokens, 694 + (1194 - estimate_tokens(thinking))
        )

    def test_missing_thinking_bills_the_full_completion(self) -> None:
        reply = {
            "message": {"content": balanced_json()},
            "prompt_eval_count": 41,
            "eval_count": 17,
        }
        with mock.patch("aim_sim.runner._post_json", return_value=reply):
            completion = OllamaProvider("ollama/llama3.1").complete("go", "{}")
        self.assertEqual(completion.reasoning_tokens, 0)
        self.assertEqual(completion.game_tokens, 58)

    def test_reasoning_estimate_never_bills_negative_answer(self) -> None:
        reply = {
            "message": {"content": balanced_json(), "thinking": "x" * 100000},
            "prompt_eval_count": 10,
            "eval_count": 20,
        }
        with mock.patch("aim_sim.runner._post_json", return_value=reply):
            completion = OllamaProvider("ollama/llama3.1").complete("go", "{}")
        self.assertEqual(completion.game_tokens, 10)


class FailureCodeTest(unittest.TestCase):
    """Provider failures classify into fixed codes, never exception text."""

    def test_unreachable_host(self) -> None:
        from aim_sim.runner import provider_failure_code

        exc = RuntimeError("local model host unreachable: refused")
        self.assertEqual(provider_failure_code(exc), "unreachable")

    def test_timeout(self) -> None:
        from aim_sim.runner import provider_failure_code

        self.assertEqual(provider_failure_code(TimeoutError("timed out")), "timeout")

    def test_missing_model(self) -> None:
        from aim_sim.runner import provider_failure_code

        exc = RuntimeError('local model call failed with HTTP 404: {"error": "x"}')
        self.assertEqual(provider_failure_code(exc), "model_missing")

    def test_rejected_request(self) -> None:
        from aim_sim.runner import provider_failure_code

        exc = RuntimeError("local model call failed with HTTP 400: bad format")
        self.assertEqual(provider_failure_code(exc), "rejected")

    def test_empty_reply(self) -> None:
        from aim_sim.runner import provider_failure_code

        self.assertEqual(
            provider_failure_code(RuntimeError("ollama returned no message content")),
            "empty_reply",
        )

    def test_unknown_failure_has_no_code(self) -> None:
        from aim_sim.runner import provider_failure_code

        self.assertIsNone(provider_failure_code(RuntimeError("boom")))
        self.assertIsNone(provider_failure_code(ValueError("nope")))


class LocalOpenAIProviderTest(unittest.TestCase):
    """OpenAI-compatible servers parse choices; usage falls back to estimates."""

    def test_complete_returns_text_and_usage(self) -> None:
        payload = {
            "choices": [{"message": {"content": balanced_json()}}],
            "usage": {"prompt_tokens": 30, "completion_tokens": 12},
        }
        with mock.patch("aim_sim.runner._post_json", return_value=payload) as posted:
            completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertEqual(completion.text, balanced_json())
        self.assertEqual(completion.prompt_tokens, 30)
        self.assertEqual(completion.completion_tokens, 12)
        self.assertTrue(posted.call_args.args[0].endswith("/chat/completions"))
        self.assertEqual(posted.call_args.args[1]["temperature"], 0)

    def test_missing_usage_falls_back_to_estimates(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with mock.patch("aim_sim.runner._post_json", return_value=payload):
            completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertGreater(completion.prompt_tokens, 0)
        self.assertGreater(completion.completion_tokens, 0)

    def test_empty_choices_is_an_error(self) -> None:
        with (
            mock.patch("aim_sim.runner._post_json", return_value={"choices": []}),
            self.assertRaises(RuntimeError),
        ):
            LocalOpenAIProvider("local/hermes3").complete("go", "{}")

    def test_format_rejection_retries_with_json_schema(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        rejection = RuntimeError("call failed with HTTP 400: ... response_format ...")
        with mock.patch(
            "aim_sim.runner._post_json", side_effect=[rejection, payload]
        ) as posted:
            completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertEqual(completion.text, balanced_json())
        self.assertEqual(posted.call_count, 2)
        first_format = posted.call_args_list[0].args[1]["response_format"]
        second_format = posted.call_args_list[1].args[1]["response_format"]
        self.assertEqual(first_format, {"type": "json_object"})
        self.assertEqual(second_format["type"], "json_schema")
        schema = second_format["json_schema"]["schema"]
        self.assertIn("housing", schema["properties"]["allocation"]["required"])

    def test_double_format_rejection_falls_back_to_no_format(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        rejection = RuntimeError("call failed with HTTP 400: ... response_format ...")
        with mock.patch(
            "aim_sim.runner._post_json", side_effect=[rejection, rejection, payload]
        ) as posted:
            completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertEqual(completion.text, balanced_json())
        self.assertEqual(posted.call_count, 3)
        self.assertNotIn("response_format", posted.call_args_list[2].args[1])

    def test_unrelated_error_does_not_retry(self) -> None:
        with (
            mock.patch(
                "aim_sim.runner._post_json",
                side_effect=RuntimeError("host unreachable: boom"),
            ) as posted,
            self.assertRaisesRegex(RuntimeError, "local openai-compatible call failed"),
        ):
            LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertEqual(posted.call_count, 1)

    def test_reasoning_details_parse_to_zero_by_default(self) -> None:
        payload = {
            "choices": [{"message": {"content": balanced_json()}}],
            "usage": {
                "prompt_tokens": 697,
                "completion_tokens": 1946,
                "completion_tokens_details": {"reasoning_tokens": 1742},
            },
        }
        with mock.patch("aim_sim.runner._post_json", return_value=payload):
            completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
        self.assertEqual(completion.reasoning_tokens, 1742)
        self.assertEqual(completion.game_tokens, 901)

    def test_bad_reasoning_details_read_as_zero(self) -> None:
        for details in ({"reasoning_tokens": -5}, {"reasoning_tokens": "lots"}, None):
            payload = {
                "choices": [{"message": {"content": balanced_json()}}],
                "usage": {
                    "prompt_tokens": 30,
                    "completion_tokens": 12,
                    "completion_tokens_details": details,
                },
            }
            with mock.patch("aim_sim.runner._post_json", return_value=payload):
                completion = LocalOpenAIProvider("local/hermes3").complete("go", "{}")
            self.assertEqual(completion.reasoning_tokens, 0)


class ReasoningTokensTest(unittest.TestCase):
    """Thinking traces don't eat the gameplay budget.

    The cap, the match budget, and recorded usage bill prompt +
    answer tokens only.
    """

    def test_game_tokens_exclude_reasoning(self) -> None:
        heavy = ProviderCompletion(
            text="{}",
            prompt_tokens=697,
            completion_tokens=1946,
            reasoning_tokens=1742,
        )
        self.assertEqual(heavy.game_tokens, 901)
        self.assertEqual(heavy.total_tokens, 2643)
        plain = ProviderCompletion(text="{}", prompt_tokens=30, completion_tokens=12)
        self.assertEqual(plain.reasoning_tokens, 0)
        self.assertEqual(plain.game_tokens, 42)
        corrupt = ProviderCompletion(
            text="{}", prompt_tokens=30, completion_tokens=12, reasoning_tokens=99
        )
        self.assertEqual(corrupt.game_tokens, 30)

    def test_thinking_turns_play_twelve_rounds(self) -> None:
        class ThinkingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=balanced_json(),
                    prompt_tokens=697,
                    completion_tokens=1946,
                    reasoning_tokens=1742,
                )

        result = MatchRunner().run("go", ThinkingProvider([balanced_json()]), seed=7)
        self.assertTrue(all(log.skip_reason is None for log in result.turns))
        self.assertTrue(all(log.tokens_used == 901 for log in result.turns))
        self.assertFalse(any(log.usage_anomaly for log in result.turns))
        self.assertEqual(result.totals["tokens_used"], 901 * 12.0)

    def test_played_turns_record_thinking(self) -> None:
        class ThinkingProvider(ScriptedProvider):
            def complete(
                self, system_prompt: str, state_json: str
            ) -> ProviderCompletion:
                del system_prompt, state_json
                return ProviderCompletion(
                    text=balanced_json(),
                    prompt_tokens=697,
                    completion_tokens=1946,
                    reasoning_tokens=1742,
                )

        result = MatchRunner().run("go", ThinkingProvider([balanced_json()]), seed=7)
        self.assertTrue(all(log.thinking_tokens == 1742 for log in result.turns))
        self.assertEqual(result.totals["thinking_tokens"], 1742 * 12.0)

    def test_skipped_turns_record_no_thinking(self) -> None:
        result = MatchRunner().run("go", ScriptedProvider(["nope"]), seed=7)
        self.assertTrue(all(log.skip_reason is not None for log in result.turns))
        self.assertTrue(all(log.thinking_tokens == 0 for log in result.turns))
        self.assertEqual(result.totals["thinking_tokens"], 0.0)


class MetaProviderTest(unittest.TestCase):
    """Meta's Llama API speaks OpenAI-compat chat completions with a token."""

    def test_complete_posts_to_meta_with_bearer_key(self) -> None:
        payload = {
            "choices": [{"message": {"content": balanced_json()}}],
            "usage": {"prompt_tokens": 30, "completion_tokens": 12},
        }
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "tok-123"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            completion = MetaProvider("meta/Llama-4-Scout").complete("go", "{}")
        self.assertEqual(completion.text, balanced_json())
        self.assertEqual(completion.prompt_tokens, 30)
        self.assertEqual(completion.completion_tokens, 12)
        self.assertTrue(
            posted.call_args.args[0].endswith("/chat/completions"),
            posted.call_args.args[0],
        )
        self.assertTrue(
            posted.call_args.args[0].startswith(meta_api_url()),
            posted.call_args.args[0],
        )
        sent = posted.call_args.args[1]
        self.assertEqual(sent["model"], "Llama-4-Scout")
        self.assertEqual(sent["temperature"], 0)
        self.assertEqual(posted.call_args.args[3], "tok-123")
        self.assertEqual(posted.call_args.args[4], "meta model")

    def test_base_url_defaults_to_meta_compat_endpoint(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_API_BASE_URL", None)
            self.assertEqual(meta_api_url(), "https://api.llama.com/compat/v1")

    def test_base_url_override_selects_a_stub(self) -> None:
        with mock.patch.dict(os.environ, {"META_API_BASE_URL": "http://stub:9/x/"}):
            self.assertEqual(meta_api_url(), "http://stub:9/x")

    def test_missing_usage_falls_back_to_estimates(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "tok-123"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload),
        ):
            completion = MetaProvider("meta/Llama-4-Scout").complete("go", "{}")
        self.assertGreater(completion.prompt_tokens, 0)
        self.assertGreater(completion.completion_tokens, 0)

    def test_empty_choices_is_an_error(self) -> None:
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "tok-123"}),
            mock.patch("aim_sim.runner._post_json", return_value={"choices": []}),
            self.assertRaises(RuntimeError),
        ):
            MetaProvider("meta/Llama-4-Scout").complete("go", "{}")

    def test_meta_defaults_curate_llama_and_muse_models(self) -> None:
        from aim_sim.runner import META_DEFAULT_MODELS

        self.assertEqual(
            META_DEFAULT_MODELS,
            (
                "meta/Llama-4-Maverick-17B-128E-Instruct-FP8",
                "meta/Llama-4-Scout-17B-16E-Instruct",
                "meta/Llama-3.3-70B-Instruct",
                "meta/muse-spark-1.3",
                "meta/muse-wonder-1.0",
            ),
        )

    def test_explicit_key_beats_the_env_slot(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "env-key"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            MetaProvider("meta/Llama-4-Scout", api_key="user-key").complete("go", "{}")
        self.assertEqual(posted.call_args.args[3], "user-key")

    def test_missing_key_falls_back_to_the_env_slot(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "env-key"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            MetaProvider("meta/Llama-4-Scout").complete("go", "{}")
        self.assertEqual(posted.call_args.args[3], "env-key")


class MetaRoutingTest(unittest.TestCase):
    """Muse models ride the Model API host; Llama models stay on theirs."""

    def test_muse_names_route_to_the_model_api(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_API_BASE_URL", None)
            os.environ.pop("META_MUSE_BASE_URL", None)
            self.assertEqual(meta_api_url("muse-spark-1.3"), "https://api.meta.ai/v1")
            self.assertEqual(meta_api_url("muse-wonder-1.0"), "https://api.meta.ai/v1")
            self.assertEqual(
                meta_api_url("Llama-3.3-70B-Instruct"),
                "https://api.llama.com/compat/v1",
            )

    def test_each_side_honors_its_own_override(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                "META_API_BASE_URL": "http://llama-stub:9/x/",
                "META_MUSE_BASE_URL": "http://muse-stub:9/y/",
            },
        ):
            self.assertEqual(meta_api_url("muse-spark-1.3"), "http://muse-stub:9/y")
            self.assertEqual(
                meta_api_url("Llama-3.3-70B-Instruct"), "http://llama-stub:9/x"
            )

    def test_muse_completion_posts_to_the_model_api(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "tok-123"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            MetaProvider("meta/muse-spark-1.3").complete("go", "{}")
        url = posted.call_args.args[0]
        self.assertTrue(url.startswith("https://api.meta.ai/v1"), url)
        self.assertEqual(posted.call_args.args[1]["model"], "muse-spark-1.3")


class BionicProviderTest(unittest.TestCase):
    """BionicGPT models route to the user's own OpenAI-compatible API."""

    def test_routing_and_detection(self) -> None:
        self.assertIsInstance(provider_for_model("bionic/llama"), BionicProvider)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(BIONIC_BASE_URL_ENV, None)
            self.assertEqual(bionic_models(), [])
        payload = {"data": [{"id": "llama"}, {"id": "mistral"}]}
        with (
            mock.patch.dict(
                os.environ,
                {BIONIC_BASE_URL_ENV: "http://bionic:9/v1", BIONIC_API_KEY_ENV: "k"},
            ),
            mock.patch("aim_sim.runner._get_json", return_value=payload),
        ):
            self.assertEqual(bionic_models(), ["bionic/llama", "bionic/mistral"])

    def test_complete_posts_to_bionic_chat(self) -> None:
        payload = {
            "choices": [{"message": {"content": balanced_json()}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 7},
        }
        with (
            mock.patch.dict(
                os.environ,
                {BIONIC_BASE_URL_ENV: "http://bionic:9/v1", BIONIC_API_KEY_ENV: "k"},
            ),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            completion = BionicProvider("bionic/llama").complete("go", "{}")
        self.assertTrue(posted.call_args.args[0].endswith("/chat/completions"))
        self.assertEqual(completion.prompt_tokens, 5)
        self.assertEqual(completion.completion_tokens, 7)

    def test_missing_base_url_is_an_error(self) -> None:
        with (
            mock.patch.dict(os.environ, {}, clear=False),
            self.assertRaises(RuntimeError),
        ):
            os.environ.pop(BIONIC_BASE_URL_ENV, None)
            BionicProvider("bionic/llama").complete("go", "{}")


class LiteLLMProviderTest(unittest.TestCase):
    """The hosted gateway pins JSON mode and zero temperature."""

    def test_complete_pins_json_mode_and_temperature(self) -> None:
        calls: dict[str, object] = {}

        class FakeLiteLLM:
            def completion(self, **kwargs: object) -> dict[str, object]:
                calls.update(kwargs)
                return {
                    "choices": [{"message": {"content": balanced_json()}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 7},
                }

        with mock.patch.dict(sys.modules, {"litellm": FakeLiteLLM()}):
            completion = LiteLLMProvider("gpt-4o-mini").complete("go", "{}")
        self.assertEqual(calls["temperature"], 0)
        self.assertEqual(calls["response_format"], {"type": "json_object"})
        self.assertEqual(completion.prompt_tokens, 5)
        self.assertEqual(completion.completion_tokens, 7)

    def test_explicit_key_rides_the_call_but_env_stays_default(self) -> None:
        calls: dict[str, object] = {}

        class FakeLiteLLM:
            def completion(self, **kwargs: object) -> dict[str, object]:
                calls.update(kwargs)
                return {
                    "choices": [{"message": {"content": balanced_json()}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 7},
                }

        with mock.patch.dict(sys.modules, {"litellm": FakeLiteLLM()}):
            LiteLLMProvider("gpt-4o-mini", api_key="user-key").complete("go", "{}")
        self.assertEqual(calls["api_key"], "user-key")
        calls.clear()
        with mock.patch.dict(sys.modules, {"litellm": FakeLiteLLM()}):
            LiteLLMProvider("gpt-4o-mini").complete("go", "{}")
        self.assertNotIn("api_key", calls)


class ProviderKeyThreadingTest(unittest.TestCase):
    """Per-request keys ride constructors, never process env."""

    def test_factory_threads_one_key_to_every_keyed_provider(self) -> None:
        self.assertIsInstance(
            provider_for_model("local/hermes3", "k"), LocalOpenAIProvider
        )
        self.assertIsInstance(
            provider_for_model("meta/Llama-4-Scout", "k"), MetaProvider
        )
        self.assertIsInstance(provider_for_model("bionic/llama", "k"), BionicProvider)
        self.assertIsInstance(provider_for_model("gpt-4o-mini", "k"), LiteLLMProvider)
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(os.environ, {META_API_KEY_ENV: "env-key"}),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            provider_for_model("meta/Llama-4-Scout", "k-meta").complete("go", "{}")
        self.assertEqual(posted.call_args.args[3], "k-meta")

    def test_bionic_prefers_the_explicit_key(self) -> None:
        payload = {"choices": [{"message": {"content": balanced_json()}}]}
        with (
            mock.patch.dict(
                os.environ,
                {
                    BIONIC_BASE_URL_ENV: "http://bionic:9/v1",
                    BIONIC_API_KEY_ENV: "env-key",
                },
            ),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            BionicProvider("bionic/llama", api_key="user-key").complete("go", "{}")
        self.assertEqual(posted.call_args.args[3], "user-key")

    def test_local_openai_prefers_the_explicit_key(self) -> None:
        payload = {
            "choices": [{"message": {"content": balanced_json()}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        }
        with (
            mock.patch.dict(os.environ, {"LOCAL_OPENAI_API_KEY": "env-key"}),
            mock.patch(
                "aim_sim.runner.local_base_for", return_value="http://local:9/v1"
            ),
            mock.patch("aim_sim.runner._post_json", return_value=payload) as posted,
        ):
            LocalOpenAIProvider("local/hermes3", api_key="user-key").complete(
                "go", "{}"
            )
        self.assertEqual(posted.call_args.args[3], "user-key")


class DetectLocalTest(unittest.TestCase):
    """Local runtimes are probed briefly; anything down yields nothing."""

    def test_compat_fallback_finds_models_on_the_second_port(self) -> None:
        # LM Studio on 1235 with 1234 down: the fallback sweep must
        # still surface its models (the regression behind empty
        # model dropdowns on port-shifted machines).
        failure = urllib.error.URLError("refused")

        def fake_get(url: str, *_args: object, **_kwargs: object) -> dict[str, object]:
            if ":1235" in url:
                return {"data": [{"id": "hermes-4-70b"}]}
            raise failure

        with mock.patch("aim_sim.runner._get_json", side_effect=fake_get):
            self.assertEqual(openai_compat_models(), ["local/hermes-4-70b"])
            self.assertEqual(local_base_for("hermes-4-70b"), "http://localhost:1235/v1")

    def test_explicit_base_disables_the_fallback_sweep(self) -> None:
        with mock.patch.dict(
            os.environ, {"LOCAL_OPENAI_BASE_URL": "http://localhost:9999/v1"}
        ):
            self.assertEqual(local_openai_urls(), ["http://localhost:9999/v1"])

    def test_ollama_tags_become_ids(self) -> None:
        payload = {"models": [{"name": "llama3.1"}, {"name": "hermes3:8b"}]}
        with mock.patch("aim_sim.runner._get_json", return_value=payload) as fetched:
            self.assertEqual(ollama_models(), ["ollama/llama3.1", "ollama/hermes3:8b"])
        self.assertTrue(fetched.call_args.args[0].endswith("/api/tags"))

    def test_capabilities_do_not_change_ids(self) -> None:
        payload = {
            "models": [
                {"name": "thinker-2", "capabilities": ["completion", "thinking"]},
                {"name": "plain-2", "capabilities": ["completion"]},
            ]
        }
        with mock.patch("aim_sim.runner._get_json", return_value=payload):
            self.assertEqual(ollama_models(), ["ollama/thinker-2", "ollama/plain-2"])

    def test_compat_models_become_ids(self) -> None:
        payload = {"data": [{"id": "hermes3"}, {"id": "other"}]}
        with mock.patch("aim_sim.runner._get_json", return_value=payload) as fetched:
            self.assertEqual(openai_compat_models(), ["local/hermes3", "local/other"])
        # Fallback sweep probes conventional bases in order (1234, 1235).
        self.assertEqual(fetched.call_count, len(LOCAL_OPENAI_FALLBACK_URLS))
        self.assertTrue(
            all(call.args[0].endswith("/models") for call in fetched.call_args_list)
        )

    def test_down_runtimes_yield_nothing(self) -> None:
        failure = urllib.error.URLError("refused")
        with mock.patch("aim_sim.runner._get_json", side_effect=failure):
            self.assertEqual(ollama_models(), [])
            self.assertEqual(openai_compat_models(), [])
            self.assertEqual(detect_local_models(), [])

    def test_malformed_lists_yield_nothing(self) -> None:
        with mock.patch("aim_sim.runner._get_json", return_value={"models": {}}):
            self.assertEqual(ollama_models(), [])

    def test_detection_dedupes_ollama_first(self) -> None:
        with mock.patch(
            "aim_sim.runner._get_json",
            side_effect=[
                {"models": [{"name": "x"}]},
                {"data": [{"id": "x"}, {"id": "y"}]},
            ],
        ):
            self.assertEqual(detect_local_models(), ["ollama/x", "local/x", "local/y"])


class _SpyProvider(MockProvider):
    """Mock play that keeps every agent-visible state it was shown."""

    def __init__(self) -> None:
        super().__init__(label="spy-test")
        self.seen: list[str] = []

    def complete(self, system_prompt: str, state_json: str) -> ProviderCompletion:
        self.seen.append(state_json)
        return super().complete(system_prompt, state_json)


def _moisture(state_json: str) -> float:
    state = json.loads(state_json)
    conditions = state["environment"]["conditions"]
    return float(conditions["moisture"])


class FieldPlanTest(unittest.TestCase):
    """Field plans fire before the bot moves and enter the replay."""

    def test_plan_records_on_the_right_turn(self) -> None:
        result = MatchRunner().run(
            "steward wisely",
            MockProvider(),
            seed=11,
            options=RunOptions(interventions=[{"turn": 5, "kind": "irrigate"}]),
        )
        fired = [log.intervention for log in result.turns]
        self.assertEqual(fired[4], "irrigate")
        self.assertEqual([entry for entry in fired if entry is not None], ["irrigate"])
        self.assertEqual(result.totals["interventions_used"], 1.0)

    def test_same_seed_and_plan_replays_exactly(self) -> None:
        plan = [{"turn": 5, "kind": "irrigate"}, {"turn": 9, "kind": "terrace"}]
        first = MatchRunner().run(
            "steward wisely",
            MockProvider(),
            seed=11,
            options=RunOptions(interventions=plan),
        )
        second = MatchRunner().run(
            "steward wisely",
            MockProvider(),
            seed=11,
            options=RunOptions(interventions=plan),
        )
        self.assertEqual(first.scores, second.scores)
        self.assertEqual(
            [log.state_hash for log in first.turns],
            [log.state_hash for log in second.turns],
        )

    def test_plan_changes_the_match(self) -> None:
        plain = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        diverted = MatchRunner().run(
            "steward wisely",
            MockProvider(),
            seed=11,
            options=RunOptions(interventions=[{"turn": 5, "kind": "vent_heat"}]),
        )
        self.assertEqual(
            [log.state_hash for log in plain.turns[:4]],
            [log.state_hash for log in diverted.turns[:4]],
        )
        self.assertNotEqual(
            [log.state_hash for log in plain.turns[4:]],
            [log.state_hash for log in diverted.turns[4:]],
        )

    def test_bot_sees_shifted_land_before_moving(self) -> None:
        plain_spy, diverted_spy = _SpyProvider(), _SpyProvider()
        MatchRunner().run("steward wisely", plain_spy, seed=11)
        MatchRunner().run(
            "steward wisely",
            diverted_spy,
            seed=11,
            options=RunOptions(interventions=[{"turn": 5, "kind": "irrigate"}]),
        )
        self.assertEqual(len(plain_spy.seen), 12)
        self.assertGreater(
            _moisture(diverted_spy.seen[4]), _moisture(plain_spy.seen[4])
        )

    def test_invalid_plan_rejected(self) -> None:
        bad_plans: list[Any] = [
            [{"turn": 5, "kind": "irrigate"}, {"turn": 5, "kind": "terrace"}],
            [{"turn": turn, "kind": "irrigate"} for turn in (1, 2, 3, 4)],
            [{"turn": 0, "kind": "irrigate"}],
            [{"turn": 3, "kind": "nuke"}],
        ]
        for plan in bad_plans:
            with self.subTest(plan=plan), self.assertRaises(InvalidActionError):
                MatchRunner().run(
                    "steward wisely",
                    MockProvider(),
                    seed=11,
                    options=RunOptions(interventions=plan),
                )


class RunningScoresTest(unittest.TestCase):
    """Every turn log carries running Impact and Efficiency."""

    def test_final_turn_matches_finished_scores(self) -> None:
        result = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        last = result.turns[-1]
        self.assertEqual(last.impact, result.scores["impact"])
        self.assertEqual(last.efficiency, result.scores["efficiency"])

    def test_every_turn_carries_running_scores(self) -> None:
        result = MatchRunner().run("steward wisely", MockProvider(), seed=11)
        self.assertEqual(len(result.turns), 12)
        for log in result.turns:
            self.assertIsInstance(log.impact, float)
            self.assertIsInstance(log.efficiency, float)

    def test_invalid_turns_keep_final_scores_exact(self) -> None:
        outputs = ["not json at all", *[balanced_json() for _ in range(11)]]
        result = MatchRunner().run("steward wisely", ScriptedProvider(outputs), seed=11)
        last = result.turns[-1]
        self.assertEqual(last.impact, result.scores["impact"])
        self.assertEqual(last.efficiency, result.scores["efficiency"])


class TurnHookTest(unittest.TestCase):
    """The on_turn hook reports every settled turn, played or skipped."""

    def test_hook_fires_once_per_turn_in_order(self) -> None:
        seen: list[tuple[int, int]] = []
        result = MatchRunner().run(
            "steward wisely",
            MockProvider(),
            seed=11,
            on_turn=lambda _log, number, total: seen.append((number, total)),
        )
        self.assertEqual(len(result.turns), 12)
        self.assertEqual(seen, [(number, 12) for number in range(1, 13)])

    def test_hook_fires_for_skipped_turns_too(self) -> None:
        seen: list[tuple[str | None, int, int]] = []
        MatchRunner().run(
            "steward wisely",
            ScriptedProvider(["not json at all"]),
            seed=11,
            on_turn=lambda log, number, total: seen.append(
                (log.skip_reason, number, total)
            ),
        )
        self.assertEqual(len(seen), 12)
        self.assertTrue(all(reason == "invalid_output" for reason, _, _ in seen))
        self.assertEqual([(n, t) for _, n, t in seen], [(n, 12) for n in range(1, 13)])


if __name__ == "__main__":
    unittest.main()
