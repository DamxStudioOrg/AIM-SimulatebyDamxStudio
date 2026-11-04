"""Run-receipt tests: sim-witnessed scores the board can trust."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import typing
import unittest
from contextlib import ExitStack
from unittest import mock

from aim_sim.receipts import RECEIPT_SECRET_ENV, sign_payload
from tests.support import balanced_json


def _scripted(outputs: list[str]) -> ExitStack:
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


class SignPayloadTest(unittest.TestCase):
    """Receipts are deterministic HMACs over canonical JSON."""

    def test_no_secret_means_no_receipt(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(RECEIPT_SECRET_ENV, None)
            self.assertIsNone(sign_payload({"game": "city"}))

    def test_signature_is_deterministic_and_secret_bound(self) -> None:
        payload = {"game": "city", "seed": 3, "impact": 62.0}
        with mock.patch.dict(os.environ, {RECEIPT_SECRET_ENV: "s3cret"}):
            first = sign_payload(payload)
            second = sign_payload(payload)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        assert first is not None and second is not None
        self.assertEqual(first, second)
        canonical = first["payload"]
        self.assertEqual(json.loads(canonical), payload)
        expected = hmac.new(
            b"s3cret", canonical.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        self.assertEqual(first["sig"], expected)
        with mock.patch.dict(os.environ, {RECEIPT_SECRET_ENV: "other"}):
            third = sign_payload(payload)
        assert third is not None
        self.assertNotEqual(third["sig"], first["sig"])

    def test_key_order_does_not_change_the_signature(self) -> None:
        with mock.patch.dict(os.environ, {RECEIPT_SECRET_ENV: "s3cret"}):
            left = sign_payload({"b": 2, "a": 1})
            right = sign_payload({"a": 1, "b": 2})
        self.assertIsNotNone(left)
        self.assertIsNotNone(right)
        assert left is not None and right is not None
        self.assertEqual(left["sig"], right["sig"])


class ReceiptEndpointTest(unittest.TestCase):
    """Match and tote payloads bind their scored fields when configured."""

    def test_match_carries_a_receipt_binding_scores(self) -> None:
        from fastapi.testclient import TestClient

        from aim_sim.api import create_app

        with (
            _scripted([balanced_json()]),
            mock.patch.dict(os.environ, {RECEIPT_SECRET_ENV: "s3cret"}),
        ):
            response = TestClient(create_app()).post(
                "/matches/run",
                json={
                    "prompt": "Hold reserves.",
                    "seed": 3,
                    "model": "local/test-model",
                    "uid": "rider-7",
                    "challenge_params": {"kind": "city", "id": "debut", "seed": 3},
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        receipt = typing.cast("dict[str, str]", body["receipt"])
        bound = typing.cast("dict[str, typing.Any]", json.loads(receipt["payload"]))
        self.assertEqual(
            (bound["game"], bound["uid"], bound["challenge"], bound["seed"]),
            ("city", "rider-7", "debut", 3),
        )
        self.assertEqual(bound["model"], "local/test-model")
        self.assertEqual(bound["turns"], 12)
        self.assertEqual(bound["impact"], body["scores"]["impact"])
        self.assertEqual(bound["efficiency"], body["scores"]["efficiency"])
        self.assertEqual(bound["badges"], body["badges"])
        expected = hmac.new(
            b"s3cret", receipt["payload"].encode("utf-8"), hashlib.sha256
        ).hexdigest()
        self.assertEqual(receipt["sig"], expected)

    def test_tote_carries_a_receipt_binding_score(self) -> None:
        import json as jsonlib

        from fastapi.testclient import TestClient

        from aim_sim.api import create_app
        from aim_sim.tote import offered_catalog

        offer = list(offered_catalog(4))
        with (
            _scripted([jsonlib.dumps({"packing": offer[:4]})]),
            mock.patch.dict(os.environ, {RECEIPT_SECRET_ENV: "s3cret"}),
        ):
            response = TestClient(create_app()).post(
                "/tote/pack",
                json={
                    "prompt": "Heavies at the bottom.",
                    "seed": 4,
                    "model": "local/test-model",
                    "uid": "rider-7",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = typing.cast("dict[str, typing.Any]", response.json())
        receipt = typing.cast("dict[str, str]", body["receipt"])
        bound = typing.cast("dict[str, typing.Any]", json.loads(receipt["payload"]))
        self.assertEqual((bound["game"], bound["uid"]), ("tote", "rider-7"))
        self.assertEqual(bound["score"], body["score"])
        self.assertEqual(bound["badges"], body["badges"])

    def test_no_secret_means_no_receipt_key(self) -> None:
        from fastapi.testclient import TestClient

        from aim_sim.api import create_app

        with (
            _scripted([balanced_json()]),
            mock.patch.dict(os.environ, {}, clear=False),
        ):
            os.environ.pop(RECEIPT_SECRET_ENV, None)
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
        self.assertNotIn("receipt", body)
