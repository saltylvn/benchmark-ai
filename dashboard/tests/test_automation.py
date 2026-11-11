"""Automation API (/api/v1) and signed webhooks. No network: Slack and webhook receivers are faked."""

import io
import json
import unittest
import urllib.error

from dashboard import automation
from dashboard.app import create_app
from dashboard.slack import SlackConfig, SlackConnector

TOKEN = "t" * 40
SECRET = "whsec_test_secret"


class Response(io.BytesIO):
    def __init__(self, body=b"{}", status=200):
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Receiver:
    """Records webhook deliveries. `script` lists what each call does: a status code or an exception."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append(request)
        step = self.script.pop(0) if self.script else 200
        if isinstance(step, Exception):
            raise step
        if step >= 400:
            raise urllib.error.HTTPError(request.full_url, step, "error", {}, None)
        return Response(status=step)


class SlackOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        if request.full_url.endswith("auth.test"):
            return Response(json.dumps({"ok": True, "team": "Summit", "user": "benchmark"}).encode())
        return Response(json.dumps({"ok": True, "channel": "C1", "ts": "1"}).encode())


def make(env=None, receiver=None, send=False):
    slack_opener = SlackOpener()
    slack = SlackConnector(SlackConfig(bot_token="xoxb-test", channel="C1", send_enabled=send), opener=slack_opener)
    base = {"AUTOMATION_TOKEN": TOKEN, "WEBHOOK_URLS": "https://hooks.example.com/benchmark", "WEBHOOK_SECRET": SECRET}
    app = create_app(slack=slack, env={**base, **(env or {})}, webhook_opener=receiver or Receiver(), webhook_background=False)
    return app, app.test_client(), slack_opener


def bearer(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


class SignatureTest(unittest.TestCase):
    def test_canonical_json_matches_what_javascript_would_produce(self):
        body = automation.canonical({"b": 82200.0, "a": "Ridgeview · Lot 14", "c": [1.5, 2.0]})
        self.assertEqual(body, '{"a":"Ridgeview · Lot 14","b":82200,"c":[1.5,2]}')

    def test_sign_and_verify_round_trip_and_reject_tampering_and_replays(self):
        body = '{"event":"approval.recorded"}'
        sig = automation.sign(SECRET, 1_700_000_000, body)
        self.assertTrue(automation.verify(SECRET, "1700000000", body, sig, now=1_700_000_100))
        self.assertFalse(automation.verify(SECRET, "1700000000", body + " ", sig, now=1_700_000_100))
        self.assertFalse(automation.verify("other", "1700000000", body, sig, now=1_700_000_100))
        self.assertFalse(automation.verify(SECRET, "1700000000", body, sig, now=1_700_000_000 + 3600))

    def test_only_https_or_localhost_receivers(self):
        hooks = automation.Webhooks(["https://ok.example.com/x", "http://evil.example.com/x", "http://localhost:5678/webhook"], SECRET)
        self.assertEqual(hooks.urls, ["https://ok.example.com/x", "http://localhost:5678/webhook"])
        self.assertEqual(hooks.rejected, ["http://evil.example.com/x"])


class ApiAuthTest(unittest.TestCase):
    def test_off_without_a_token_and_weak_tokens_are_refused(self):
        _, client, _ = make(env={"AUTOMATION_TOKEN": ""})
        self.assertEqual(client.get("/api/v1/morning", headers=bearer("")).status_code, 503)
        _, client, _ = make(env={"AUTOMATION_TOKEN": "short"})
        self.assertIn("32 characters", client.get("/api/v1/morning", headers=bearer("short")).get_json()["error"])

    def test_wrong_or_missing_token_is_401(self):
        _, client, _ = make()
        self.assertEqual(client.get("/api/v1/morning").status_code, 401)
        self.assertEqual(client.get("/api/v1/morning", headers=bearer("x" * 40)).status_code, 401)

    def test_a_browser_session_does_not_unlock_the_machine_api(self):
        _, client, _ = make()
        client.get("/demo")
        self.assertEqual(client.get("/api/v1/morning").status_code, 401)


class ApiTest(unittest.TestCase):
    def test_morning_summarises_what_is_waiting(self):
        _, client, _ = make()
        body = client.get("/api/v1/morning", headers=bearer()).get_json()
        self.assertEqual(body["date"], "2026-03-12")
        self.assertEqual(body["jobs"], {"on-track": 3, "at-risk": 6, "behind": 1})
        self.assertEqual(body["waiting"], len(body["items"]))
        self.assertGreater(body["blocked"], 0)
        self.assertIn("Good morning", body["brief"])
        draw = next(i for i in body["items"] if i["kindLabel"] == "Loan draw")
        self.assertEqual(draw["amount"], 82200)

    def test_queue_filters_by_owner_and_level(self):
        _, client, _ = make()
        items = client.get("/api/v1/queue?owner=renee&level=blocked", headers=bearer()).get_json()["items"]
        self.assertTrue(items)
        self.assertTrue(all(i["owner"] == "renee" and i["level"] == "blocked" for i in items))

    def test_brief_send_is_a_dry_run_until_sending_is_enabled(self):
        receiver = Receiver()
        _, client, slack = make(receiver=receiver)
        body = client.post("/api/v1/brief/send", headers=bearer()).get_json()
        self.assertEqual(body["result"], "dry-run")
        self.assertFalse([r for r in slack.requests if r.full_url.endswith("chat.postMessage")])
        self.assertEqual(receiver.calls, [])

    def test_brief_send_posts_once_a_day_and_announces_it(self):
        receiver = Receiver()
        _, client, slack = make(receiver=receiver, send=True)
        self.assertEqual(client.post("/api/v1/brief/send", headers=bearer()).get_json()["result"], "sent")
        self.assertEqual(client.post("/api/v1/brief/send", headers=bearer()).get_json()["result"], "already-sent")
        self.assertEqual(client.post("/api/v1/brief/send", headers=bearer(), json={"force": True}).get_json()["result"], "sent")
        posts = [r for r in slack.requests if r.full_url.endswith("chat.postMessage")]
        self.assertEqual(len(posts), 2)
        self.assertEqual([c.headers["X-benchmark-event"] for c in receiver.calls], ["brief.sent", "brief.sent"])

    def test_approval_needs_a_named_person_on_the_allow_list(self):
        _, client, _ = make(env={"ALLOWED_EMAILS": "renee@example.com"})
        self.assertEqual(client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "approve"}).status_code, 400)
        refused = client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "approve", "by": {"name": "Eve", "email": "eve@example.com"}})
        self.assertEqual(refused.status_code, 403)
        ok = client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "approve", "by": {"name": "Renee Walsh", "email": "renee@example.com"}})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.get_json()["via"], "api")

    def test_approved_item_leaves_the_morning_queue(self):
        app, client, _ = make()
        before = client.get("/api/v1/morning", headers=bearer()).get_json()["waiting"]
        client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "skip", "by": {"name": "Renee", "email": "renee@example.com"}})
        self.assertEqual(client.get("/api/v1/morning", headers=bearer()).get_json()["waiting"], before - 1)

    def test_unknown_item_is_404(self):
        _, client, _ = make()
        response = client.post("/api/v1/approvals", headers=bearer(), json={"id": "D999", "act": "approve", "by": {"name": "R", "email": "r@example.com"}})
        self.assertEqual(response.status_code, 404)


class WebhookDeliveryTest(unittest.TestCase):
    def test_api_approval_emits_a_signed_canonical_event(self):
        receiver = Receiver()
        _, client, _ = make(receiver=receiver)
        client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "approve", "by": {"name": "Renee Walsh", "email": "renee@example.com"}})
        self.assertEqual(len(receiver.calls), 1)
        call = receiver.calls[0]
        body = call.data.decode()
        payload = json.loads(body)
        self.assertEqual(payload["event"], "approval.recorded")
        self.assertEqual(payload["data"]["by"], "Renee Walsh")
        self.assertEqual(payload["data"]["item"]["id"], "D1")
        self.assertEqual(body, automation.canonical(payload))
        ts = call.headers["X-benchmark-timestamp"]
        self.assertTrue(automation.verify(SECRET, ts, body, call.headers["X-benchmark-signature"]))

    def test_demo_clicks_are_never_announced(self):
        receiver = Receiver()
        _, client, _ = make(receiver=receiver)
        client.get("/demo")
        client.get("/")
        with client.session_transaction() as s:
            token = s["csrf"]
        client.post("/api/approve", json={"id": "D1", "act": "approve"}, headers={"X-Form-Token": token})
        self.assertEqual(receiver.calls, [])

    def test_retries_server_errors_and_network_failures_then_logs_each_attempt(self):
        receiver = Receiver(503, urllib.error.URLError("connection refused"), 200)
        app, client, _ = make(receiver=receiver)
        app.extensions["webhooks"].sleep = lambda s: None
        client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "skip", "by": {"name": "R", "email": "r@example.com"}})
        log = app.extensions["store"].get("webhookLog")
        self.assertEqual([e["attempt"] for e in log], [1, 2, 3])
        self.assertEqual([e["ok"] for e in log], [False, False, True])

    def test_does_not_retry_a_deliberate_rejection(self):
        receiver = Receiver(401)
        app, client, _ = make(receiver=receiver)
        client.post("/api/v1/approvals", headers=bearer(), json={"id": "D1", "act": "skip", "by": {"name": "R", "email": "r@example.com"}})
        self.assertEqual(len(receiver.calls), 1)
        self.assertEqual(app.extensions["store"].get("webhookLog")[-1]["status"], 401)


if __name__ == "__main__":
    unittest.main()


class FixtureTest(unittest.TestCase):
    def test_committed_fixture_is_what_this_service_signs(self):
        from pathlib import Path

        fixture = json.loads((Path(__file__).resolve().parents[2] / "integrations/fixtures/approval-recorded.json").read_text(encoding="utf-8"))
        self.assertEqual(automation.canonical(json.loads(fixture["body"])), fixture["body"])
        self.assertEqual(automation.sign(fixture["secret"], fixture["timestamp"], fixture["body"]), fixture["signature"])
