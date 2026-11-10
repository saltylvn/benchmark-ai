import io
import json
import unittest
import urllib.request

from dashboard.app import create_app, slack_messages
from dashboard.insights import (
    DEFAULT_ASSUMPTIONS,
    DEFAULT_SNAPSHOT,
    build_view,
    compliance_items,
    load_json,
    schedule_changes,
    time_ledger,
)
from dashboard.slack import SlackConfig, SlackConnector


def snapshot():
    return load_json(DEFAULT_SNAPSHOT)


def assumptions():
    return load_json(DEFAULT_ASSUMPTIONS)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class RecordingOpener:
    def __init__(self, *bodies):
        self.bodies = list(bodies)
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        return FakeResponse(self.bodies.pop(0).encode())


class InsightsTest(unittest.TestCase):
    def test_war_room_matches_the_agent_run(self):
        run = snapshot()["runs"]["warRoom"]
        self.assertEqual(run["status"], "approved")
        self.assertEqual([c["score"] for c in run["critiques"]], [75, 100])

    def test_schedule_diff_never_moves_fixed_events(self):
        changes = schedule_changes(snapshot()["runs"]["warRoom"])
        self.assertFalse([m for m in changes["moved"] if m["fixed"]])
        moved = {m["id"]: (m["from"], m["when"]) for m in changes["moved"]}
        self.assertEqual(moved["northwind"], ("10:30–11:15", "13:45–14:30"))
        self.assertEqual(moved["focus"], ("09:00–11:00", "09:40–11:20"))
        self.assertIn("meridian", {a["id"] for a in changes["added"]})

    def test_expired_certificate_is_blocked(self):
        items = {i["id"]: i for i in compliance_items(snapshot()["runs"]["warRoom"])}
        self.assertEqual(items["COI-1042"]["level"], "blocked")
        self.assertEqual(items["COI-1042"]["kind"], "Insurance certificate")
        self.assertEqual(items["INSP-1042"]["kind"], "Inspection")

    def test_time_ledger_counts_come_from_the_run(self):
        run = snapshot()["runs"]["warRoom"]
        a = assumptions()
        ledger = time_ledger(run, a)
        self.assertEqual(ledger["reviewMinutes"], len(run["actions"]) * a["reviewMinutesPerDraft"])
        self.assertAlmostEqual(ledger["netMinutes"], ledger["manualMinutes"] - ledger["reviewMinutes"])
        calendar = next(l for l in ledger["lines"] if l["task"].startswith("Move or create"))
        self.assertEqual(calendar["count"], 6)
        self.assertEqual((ledger["manualMinutes"], ledger["netMinutes"]), (76, 68))

    def test_ledger_follows_edited_assumptions(self):
        run = snapshot()["runs"]["warRoom"]
        a = assumptions()
        a["manualMinutes"] = {k: 0 for k in a["manualMinutes"]}
        self.assertLess(time_ledger(run, a)["netMinutes"], 0)

    def test_insights_name_the_critic_catch(self):
        view = build_view(snapshot(), assumptions())
        tones = [i["tone"] for i in view["insights"]]
        self.assertEqual(tones[0], "catch")
        self.assertIn("FOCUS_BLOCK", view["insights"][0]["title"])
        self.assertIn("13:30–15:20", view["insights"][0]["body"])
        self.assertIn("risk", tones)

    def test_before_lane_flags_the_double_booking(self):
        lanes = build_view(snapshot(), assumptions())["lanes"]
        self.assertEqual(lanes[0]["status"], "conflict")
        overlapping = {b["id"] for b in lanes[0]["blocks"] if b["overlap"]}
        self.assertEqual(overlapping, {"focus", "northwind"})
        self.assertEqual([l["status"] for l in lanes[1:]], ["rejected", "approved"])


class SlackTest(unittest.TestCase):
    def test_not_connected_is_a_dry_run(self):
        slack = SlackConnector(SlackConfig())
        result = slack.send("hi", context="t", approved_by="Maria")
        self.assertEqual(result["result"], "dry-run")
        self.assertEqual(result["payload"]["text"], "hi")

    def test_connected_but_sends_off_is_a_dry_run(self):
        opener = RecordingOpener()
        slack = SlackConnector(SlackConfig(bot_token="xoxb-test", channel="C1"), opener=opener)
        self.assertEqual(slack.send("hi", context="t", approved_by="Maria")["result"], "dry-run")
        self.assertEqual(opener.requests, [])

    def test_bot_status_uses_auth_test(self):
        opener = RecordingOpener(json.dumps({"ok": True, "team": "Summit", "user": "benchmark"}))
        status = SlackConnector(SlackConfig(bot_token="xoxb-test", channel="C1"), opener=opener).status()
        self.assertTrue(status["connected"])
        self.assertTrue(opener.requests[0].full_url.endswith("/auth.test"))
        self.assertEqual(opener.requests[0].get_header("Authorization"), "Bearer xoxb-test")

    def test_bot_status_reports_slack_errors(self):
        opener = RecordingOpener(json.dumps({"ok": False, "error": "invalid_auth"}))
        status = SlackConnector(SlackConfig(bot_token="xoxb-bad", channel="C1"), opener=opener).status()
        self.assertFalse(status["connected"])
        self.assertIn("invalid_auth", status["detail"])

    def test_bot_send_posts_to_chat_post_message(self):
        opener = RecordingOpener(json.dumps({"ok": True, "channel": "C1", "ts": "1.2"}))
        slack = SlackConnector(SlackConfig(bot_token="xoxb-test", channel="C1", send_enabled=True), opener=opener)
        result = slack.send("crew update", context="war room", approved_by="Maria")
        self.assertEqual(result["result"], "sent")
        request = opener.requests[0]
        self.assertTrue(request.full_url.endswith("/chat.postMessage"))
        body = json.loads(request.data)
        self.assertEqual(body["channel"], "C1")
        self.assertIn("approved by Maria", json.dumps(body["blocks"]))

    def test_webhook_send(self):
        opener = RecordingOpener("ok")
        cfg = SlackConfig(webhook_url="https://hooks.slack.com/services/T/B/X", send_enabled=True)
        result = SlackConnector(cfg, opener=opener).send("x", context="c", approved_by="m")
        self.assertEqual(result["result"], "sent")

    def test_webhook_rejects_other_hosts(self):
        cfg = SlackConfig(webhook_url="https://evil.example/hook", send_enabled=True)
        result = SlackConnector(cfg, opener=RecordingOpener()).send("x", context="c", approved_by="m")
        self.assertEqual(result["result"], "error")

    def test_send_flag_must_be_exactly_one(self):
        self.assertFalse(SlackConfig.from_env({"SLACK_SEND_ENABLED": "true"}).send_enabled)
        self.assertTrue(SlackConfig.from_env({"SLACK_SEND_ENABLED": "1"}).send_enabled)


class AppTest(unittest.TestCase):
    def setUp(self):
        self.slack = SlackConnector(SlackConfig())
        self.app = create_app(slack=self.slack)
        self.client = self.app.test_client()

    def test_pages_render(self):
        for path in ("/", "/?run=morning"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"Critic scorecard", response.data)
        self.assertEqual(self.client.get("/?run=nope").status_code, 404)

    def test_api(self):
        data = self.client.get("/api/runs/warRoom").get_json()
        self.assertIn("insights", data)
        self.assertFalse(self.client.get("/api/slack/status").get_json()["connected"])

    def test_slack_messages_include_draft_and_brief(self):
        ids = [m["id"] for m in slack_messages(snapshot()["runs"]["warRoom"])]
        self.assertEqual(ids, ["slack-draft", "brief"])

    def test_approve_requires_form_token(self):
        response = self.client.post("/slack/send", data={"run": "warRoom", "message": "brief"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.slack.audit, [])

    def test_approve_records_audit(self):
        token = self.app.config["FORM_TOKEN"]
        response = self.client.post(
            "/slack/send",
            data={"token": token, "run": "warRoom", "message": "slack-draft", "approved_by": "Maria"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.slack.audit[0]["result"], "dry-run")
        self.assertIn("Estimate block stays", self.slack.audit[0]["payload"]["text"])


if __name__ == "__main__":
    unittest.main()
