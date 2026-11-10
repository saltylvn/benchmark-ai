import io
import json
import unittest
import urllib.parse
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
        run = snapshot()["runs"]["thursday"]
        self.assertEqual(run["status"], "approved")
        self.assertEqual([c["score"] for c in run["critiques"]], [75, 100])

    def test_schedule_diff_never_moves_fixed_events(self):
        changes = schedule_changes(snapshot()["runs"]["thursday"])
        self.assertFalse([m for m in changes["moved"] if m["fixed"]])
        moved = {m["id"]: (m["from"], m["when"]) for m in changes["moved"]}
        self.assertEqual(moved["brightspark"], ("10:30–11:15", "13:45–14:30"))
        self.assertEqual(moved["focus"], ("09:00–11:00", "09:40–11:20"))
        self.assertIn("rivera", {a["id"] for a in changes["added"]})

    def test_expired_certificate_is_blocked(self):
        items = {i["id"]: i for i in compliance_items(snapshot()["runs"]["thursday"])}
        self.assertEqual(items["COI-1042"]["level"], "blocked")
        self.assertEqual(items["COI-1042"]["kind"], "Insurance certificate")
        self.assertEqual(items["INSP-1042"]["kind"], "Inspection")

    def test_time_ledger_counts_come_from_the_run(self):
        run = snapshot()["runs"]["thursday"]
        a = assumptions()
        ledger = time_ledger(run, a)
        self.assertEqual(ledger["reviewMinutes"], len(run["actions"]) * a["reviewMinutesPerDraft"])
        self.assertAlmostEqual(ledger["netMinutes"], ledger["manualMinutes"] - ledger["reviewMinutes"])
        calendar = next(l for l in ledger["lines"] if l["task"].startswith("Move or create"))
        self.assertEqual(calendar["count"], 6)
        self.assertEqual((ledger["manualMinutes"], ledger["netMinutes"]), (76, 68))

    def test_ledger_follows_edited_assumptions(self):
        run = snapshot()["runs"]["thursday"]
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
        self.assertEqual(overlapping, {"focus", "brightspark"})
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
        result = slack.send("crew update", context="thursday", approved_by="Maria")
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
        self.app = create_app(slack=self.slack, env={})
        self.client = self.app.test_client()
        self.client.get("/demo")

    def test_welcome_comes_first(self):
        fresh = self.app.test_client()
        page = fresh.get("/").data
        self.assertIn(b"View the demo", page)
        for label in (b"Google", b"Slack", b"Microsoft 365", b"Procore"):
            self.assertIn(label, page)
        self.assertNotIn(b"Critic scorecard", page)
        self.assertEqual(fresh.get("/api/runs/thursday").status_code, 401)

    def test_unconfigured_provider_explains_itself(self):
        fresh = self.app.test_client()
        response = fresh.get("/login/google", follow_redirects=True)
        self.assertIn(b"GOOGLE_CLIENT_ID", response.data)

    def test_sign_out_returns_to_welcome(self):
        self.client.get("/logout")
        self.assertIn(b"View the demo", self.client.get("/").data)

    def test_pages_render(self):
        for path in ("/", "/?run=morning"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"Critic scorecard", response.data)
        self.assertEqual(self.client.get("/?run=nope").status_code, 404)

    def test_api(self):
        data = self.client.get("/api/runs/thursday").get_json()
        self.assertIn("insights", data)
        self.assertFalse(self.client.get("/api/slack/status").get_json()["connected"])

    def test_slack_messages_include_draft_and_brief(self):
        ids = [m["id"] for m in slack_messages(snapshot()["runs"]["thursday"])]
        self.assertEqual(ids, ["slack-draft", "brief"])

    def test_approve_requires_form_token(self):
        response = self.client.post("/slack/send", data={"run": "thursday", "message": "brief"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.slack.audit, [])

    def test_approve_records_audit(self):
        token = self.app.config["FORM_TOKEN"]
        response = self.client.post(
            "/slack/send",
            data={"token": token, "run": "thursday", "message": "slack-draft"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.slack.audit[0]["result"], "dry-run")
        self.assertEqual(self.slack.audit[0]["approvedBy"], "Demo viewer")
        self.assertIn("Estimate block stays", self.slack.audit[0]["payload"]["text"])


class SignInTest(unittest.TestCase):
    ENV = {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "secret", "DASHBOARD_SECRET": "x" * 32}

    def make(self, opener, env=None, slack=None):
        app = create_app(env=env or self.ENV, auth_opener=opener, slack=slack or SlackConnector(SlackConfig()))
        return app, app.test_client()

    def start(self, client):
        response = client.get("/login/google")
        self.assertEqual(response.status_code, 302)
        location = response.headers["Location"]
        self.assertTrue(location.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)
        self.assertEqual(query["client_id"], ["cid"])
        self.assertTrue(query["redirect_uri"][0].endswith("/auth/google/callback"))
        return query["state"][0]

    def test_google_round_trip(self):
        opener = RecordingOpener(
            json.dumps({"access_token": "at"}),
            json.dumps({"email": "maria@summitridge.example", "name": "Maria Alvarez"}),
        )
        _, client = self.make(opener)
        state = self.start(client)
        client.get(f"/auth/google/callback?code=abc&state={state}")
        page = client.get("/").data
        self.assertIn(b"Maria Alvarez", page)
        self.assertIn(b"Critic scorecard", page)
        token_request = opener.requests[0]
        self.assertEqual(token_request.full_url, "https://oauth2.googleapis.com/token")
        self.assertIn(b"code=abc", token_request.data)
        self.assertEqual(opener.requests[1].get_header("Authorization"), "Bearer at")

    def test_state_mismatch_is_rejected(self):
        opener = RecordingOpener()
        _, client = self.make(opener)
        self.start(client)
        response = client.get("/auth/google/callback?code=abc&state=forged", follow_redirects=True)
        self.assertIn(b"expired", response.data)
        self.assertEqual(opener.requests, [])
        self.assertIn(b"View the demo", client.get("/").data)

    def test_domain_allow_list(self):
        opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": "x@gmail.com", "name": "X"}))
        _, client = self.make(opener, env={**self.ENV, "ALLOWED_EMAIL_DOMAINS": "summitridge.example"})
        state = self.start(client)
        response = client.get(f"/auth/google/callback?code=abc&state={state}", follow_redirects=True)
        self.assertIn(b"allowed company domain", response.data)

    def test_demo_never_posts_even_when_sending_is_on(self):
        slack_opener = RecordingOpener()
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1", send_enabled=True), opener=slack_opener)
        app, client = self.make(RecordingOpener(), slack=slack)
        client.get("/demo")
        client.post("/slack/send", data={"token": app.config["FORM_TOKEN"], "run": "thursday", "message": "brief"})
        self.assertEqual(slack.audit[0]["mode"], "demo")
        self.assertEqual(slack_opener.requests, [])

    def test_signed_in_user_is_the_approver(self):
        auth_opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": "maria@summitridge.example", "name": "Maria Alvarez"}))
        slack_opener = RecordingOpener(json.dumps({"ok": True, "channel": "C1", "ts": "1.2"}))
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1", send_enabled=True), opener=slack_opener)
        app, client = self.make(auth_opener, slack=slack)
        state = self.start(client)
        client.get(f"/auth/google/callback?code=abc&state={state}")
        client.post("/slack/send", data={"token": app.config["FORM_TOKEN"], "run": "thursday", "message": "slack-draft"})
        self.assertEqual(slack.audit[0]["result"], "sent")
        self.assertEqual(slack.audit[0]["approvedBy"], "Maria Alvarez (maria@summitridge.example)")


class SiteBuildTest(unittest.TestCase):
    def test_site_is_installable(self):
        import tempfile
        from pathlib import Path

        from dashboard.static_export import build_site

        with tempfile.TemporaryDirectory() as tmp:
            out = build_site(Path(tmp) / "site")
            names = {p.name for p in out.iterdir()}
            self.assertTrue({"index.html", "manifest.webmanifest", "sw.js", "apple-touch-icon.png", "icon-512.png", "icon.svg"} <= names)
            manifest = json.loads((out / "manifest.webmanifest").read_text())
            self.assertEqual((manifest["display"], manifest["start_url"]), ("standalone", "./"))
            html = (out / "index.html").read_text()
            self.assertIn('rel="apple-touch-icon" href="apple-touch-icon.png"', html)
            self.assertIn("Add to Home Screen", html)
            self.assertNotIn('href="/', html)
            self.assertIn("benchmark-", (out / "sw.js").read_text())


class StaticExportTest(unittest.TestCase):
    def test_static_copy_is_self_contained(self):
        from dashboard.static_export import render_static

        html = render_static()
        self.assertTrue(html.lstrip().startswith("<title>"))
        self.assertIn("View the demo", html)
        self.assertIn('id="view-thursday"', html)
        self.assertIn('id="view-morning"', html)
        self.assertNotIn("<form", html)
        self.assertNotIn('href="/', html)
        self.assertNotIn("<link", html)


if __name__ == "__main__":
    unittest.main()
