import io
import json
import unittest
import urllib.parse
import urllib.request
from pathlib import Path

from dashboard.app import create_app
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


def csrf(client):
    """The page hands each session its own token; read it the way the page's script would."""
    client.get("/")
    with client.session_transaction() as sess:
        return sess["csrf"]


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
        calendar = next(ln for ln in ledger["lines"] if ln["task"].startswith("Move or create"))
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
        self.assertEqual([lane["status"] for lane in lanes[1:]], ["rejected", "approved"])


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

    def test_status_is_cached_between_page_loads(self):
        clock = {"t": 0.0}
        opener = RecordingOpener(*[json.dumps({"ok": True, "team": "S", "user": "b"})] * 2)
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1"), opener=opener, clock=lambda: clock["t"])
        slack.status()
        slack.status()
        self.assertEqual(len(opener.requests), 1)
        clock["t"] = 61
        slack.status()
        self.assertEqual(len(opener.requests), 2)

    def test_send_flag_must_be_exactly_one(self):
        self.assertFalse(SlackConfig.from_env({"SLACK_SEND_ENABLED": "true"}).send_enabled)
        self.assertTrue(SlackConfig.from_env({"SLACK_SEND_ENABLED": "1"}).send_enabled)


class AppTest(unittest.TestCase):
    def setUp(self):
        self.slack = SlackConnector(SlackConfig())
        self.app = create_app(slack=self.slack, env={})
        self.client = self.app.test_client()
        self.client.get("/demo")

    def test_today_shows_since_yesterday(self):
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn("Since yesterday", page)
        self.assertIn("Drywall done on J-1031 Hayes basement", page)
        self.assertIn('class="jchanges"', page)

    def test_stylesheet_url_changes_when_the_file_does(self):
        page = self.client.get("/").get_data(as_text=True)
        self.assertRegex(page, r'/static/dashboard\.css\?v=\d{9,}')

    def test_landing_uses_the_demo_numbers_not_claims(self):
        page = self.app.test_client().get("/").get_data(as_text=True)
        self.assertIn("For new-home builders", page)
        self.assertIn("$82,200", page)  # the draw the Coordinator drafted
        self.assertIn("the sample builder in the demo", page)
        self.assertIn("Lien waivers before final payments", page)  # a real check name from the sweep
        self.assertIn("estimate", page)
        self.assertIn("View the demo", page)

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

    def approve(self, item_id, act="approve", token=None, client=None):
        client = client or self.client
        return client.post("/api/approve", json={"id": item_id, "act": act}, headers={"X-Form-Token": token or csrf(client)})

    def test_app_renders_all_tabs(self):
        page = self.client.get("/").data
        for marker in (b'id="tab-today"', b'id="tab-jobs"', b'id="tab-team"', b'id="tab-messages"', b'id="tab-hood"', b"Critic scorecard"):
            self.assertIn(marker, page)
        self.assertIn(b"Cedar duplex", page)
        self.assertIn(b"brief", page)
        self.assertIn(b"Good morning", page)

    def test_api(self):
        data = self.client.get("/api/runs/thursday").get_json()
        self.assertIn("insights", data)
        team = self.client.get("/api/team").get_json()
        self.assertEqual(team["counts"], {"on-track": 3, "at-risk": 6, "behind": 1})
        self.assertFalse(self.client.get("/api/slack/status").get_json()["connected"])

    def test_approve_requires_form_token(self):
        self.assertEqual(self.approve("D1", token="stale").status_code, 400)
        self.assertEqual(self.slack.audit, [])

    def test_approving_a_slack_draft_previews_for_demo(self):
        rec = self.approve("D1").get_json()
        self.assertEqual(rec["by"], "Demo viewer")
        self.assertIn("Preview only", rec["detail"])
        self.assertEqual(self.slack.audit[0]["mode"], "demo")
        self.assertIn("#subs-brightspark", self.slack.audit[0]["payload"]["text"])

    def test_approving_an_invoice_never_touches_slack(self):
        rec = self.approve("D5").get_json()
        self.assertIn("stay drafts", rec["detail"])
        self.assertEqual(self.slack.audit, [])

    def test_skip_and_unknown_items(self):
        self.assertEqual(self.approve("R3", act="skip").get_json()["act"], "skip")
        self.assertEqual(self.approve("nope").status_code, 404)
        self.assertEqual(self.approve("D1", act="delete").status_code, 400)

    def test_client_page_shows_progress_but_no_internal_risks(self):
        page = self.client.get("/jobs/J-1038/client").get_data(as_text=True)
        self.assertIn("Pinecrest addition", page)
        self.assertIn("40% complete", page)
        self.assertIn("Maria Alvarez", page)
        for internal in ("insurance", "Bright Spark", "lien waiver", "Lien", "double", "blocked", "$"):
            self.assertNotIn(internal, page)
        self.assertEqual(self.client.get("/jobs/J-9999/client").status_code, 404)
        self.assertEqual(self.app.test_client().get("/jobs/J-1038/client").status_code, 302)

    def test_security_headers(self):
        headers = self.client.get("/").headers
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_csrf_token_is_per_session(self):
        other = self.app.test_client()
        other.get("/demo")
        self.assertEqual(self.approve("D1", token=csrf(other)).status_code, 400)

    def test_demo_approvals_stay_with_that_visitor(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(env={}, state_dir=tmp, slack=SlackConnector(SlackConfig()))
            first, second = app.test_client(), app.test_client()
            first.get("/demo")
            second.get("/demo")
            self.approve("D1", client=first)
            self.assertIn(b'"D1": {', first.get("/").data)
            self.assertNotIn(b'"D1": {', second.get("/").data)
            self.assertEqual(app.extensions["store"].get("approvals", {}), {})

    def test_signed_in_approvals_and_slack_log_survive_a_restart(self):
        import tempfile

        env = {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "s", "DASHBOARD_SECRET": "x" * 32}
        with tempfile.TemporaryDirectory() as tmp:
            opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": "maria@summitridge.example", "name": "Maria Alvarez"}))
            first = create_app(env=env, state_dir=tmp, auth_opener=opener, slack=SlackConnector(SlackConfig()))
            c1 = first.test_client()
            location = c1.get("/login/google").headers["Location"]
            state = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)["state"][0]
            c1.get(f"/auth/google/callback?code=abc&state={state}")
            self.approve("D1", client=c1)
            second = create_app(env=env, state_dir=tmp, slack=SlackConnector(SlackConfig()))
            with second.test_client() as c2:
                with c2.session_transaction() as sess:
                    sess["user"] = {"name": "Jordan Pike", "email": "j@summitridge.example", "provider": "google", "providerLabel": "Google"}
                self.assertIn(b'"D1": {', c2.get("/").data)
            self.assertEqual(second.extensions["slack"].audit[0]["approvedBy"], "Maria Alvarez (maria@summitridge.example)")

    def test_missing_or_stale_snapshot_explains_the_fix(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "snapshot.json"
            bad.write_text(json.dumps({"schema": 0}))
            app = create_app(snapshot_path=bad, env={}, slack=SlackConnector(SlackConfig()))
            client = app.test_client()
            client.get("/demo")
            response = client.get("/")
            self.assertEqual(response.status_code, 503)
            self.assertIn(b"npm run export:dashboard", response.data)

    def test_approvals_survive_a_reload(self):
        self.approve("D5")
        self.assertIn(b'"D5": {', self.client.get("/").data)


class DeployTest(unittest.TestCase):
    def test_render_address_drives_callbacks_and_secure_cookies(self):
        from dashboard.app import public_url

        self.assertEqual(public_url({"RENDER_EXTERNAL_URL": "https://benchmark.onrender.com/"}), "https://benchmark.onrender.com")
        self.assertEqual(public_url({"PUBLIC_URL": "https://pm.example.com", "RENDER_EXTERNAL_URL": "https://x.onrender.com"}), "https://pm.example.com")
        app = create_app(slack=SlackConnector(SlackConfig()), env={"RENDER_EXTERNAL_URL": "https://benchmark.onrender.com", "GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "s"})
        self.assertTrue(app.config["SESSION_COOKIE_SECURE"])
        location = app.test_client().get("/login/google").headers["Location"]
        self.assertIn("redirect_uri=https%3A%2F%2Fbenchmark.onrender.com%2Fauth%2Fgoogle%2Fcallback", location)

    def test_wsgi_entry_trusts_the_proxy_for_https(self):
        import importlib

        wsgi = importlib.import_module("dashboard.wsgi")
        client = wsgi.app.test_client()
        self.assertEqual(client.get("/healthz").status_code, 200)
        page = client.get("/", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "benchmark.onrender.com"})
        self.assertEqual(page.status_code, 200)

    def test_render_blueprint_matches_the_app(self):
        text = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")
        self.assertIn("gunicorn dashboard.wsgi:app", text)
        self.assertIn("--workers 1", text)  # one process: file-backed approvals and a single brief scheduler
        self.assertIn("healthCheckPath: /healthz", text)
        self.assertIn("generateValue: true", text)


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
        self.assertIn(b"sign-in list", response.data)
        self.assertNotIn(b"Sign out", response.data)

    def test_named_emails_can_sign_in_and_others_cannot(self):
        env = {**self.ENV, "ALLOWED_EMAILS": "Owner@Gmail.com, pm@gmail.com"}
        for email, ok in (("owner@gmail.com", True), ("stranger@gmail.com", False)):
            opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": email, "name": "N", "email_verified": True}))
            _, client = self.make(opener, env=env)
            state = self.start(client)
            page = client.get(f"/auth/google/callback?code=abc&state={state}", follow_redirects=True).data
            self.assertEqual(b"sign-in list" not in page, ok, email)

    def test_unverified_email_is_refused(self):
        opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": "a@gmail.com", "name": "A", "email_verified": False}))
        _, client = self.make(opener)
        state = self.start(client)
        self.assertIn(b"not verified", client.get(f"/auth/google/callback?code=abc&state={state}", follow_redirects=True).data)

    def test_demo_never_posts_even_when_sending_is_on(self):
        slack_opener = RecordingOpener(json.dumps({"ok": True, "team": "Summit", "user": "benchmark"}))
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1", send_enabled=True), opener=slack_opener)
        app, client = self.make(RecordingOpener(), slack=slack)
        client.get("/demo")
        client.post("/api/approve", json={"id": "digest", "act": "approve"}, headers={"X-Form-Token": csrf(client)})
        self.assertEqual(slack.audit[0]["mode"], "demo")
        self.assertEqual([r.full_url.rsplit("/", 1)[-1] for r in slack_opener.requests], ["auth.test"])

    def test_signed_in_user_is_the_approver(self):
        auth_opener = RecordingOpener(json.dumps({"access_token": "at"}), json.dumps({"email": "maria@summitridge.example", "name": "Maria Alvarez"}))
        slack_opener = RecordingOpener(json.dumps({"ok": True, "team": "Summit", "user": "benchmark"}), json.dumps({"ok": True, "channel": "C1", "ts": "1.2"}))
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1", send_enabled=True), opener=slack_opener)
        app, client = self.make(auth_opener, slack=slack)
        state = self.start(client)
        client.get(f"/auth/google/callback?code=abc&state={state}")
        rec = client.post("/api/approve", json={"id": "D1", "act": "approve"}, headers={"X-Form-Token": csrf(client)}).get_json()
        self.assertEqual(rec["detail"], "Posted to Slack")
        self.assertEqual(slack.audit[0]["result"], "sent")
        self.assertEqual(slack.audit[0]["approvedBy"], "Maria Alvarez (maria@summitridge.example)")


class TeamViewTest(unittest.TestCase):
    def view(self):
        from dashboard.portfolio import build_team_view

        return build_team_view(snapshot(), assumptions())

    def test_since_yesterday_groups_and_tags_job_cards(self):
        t = self.view()
        since = t["since"]
        self.assertEqual(since["sinceLabel"], "Wed, Mar 11")
        self.assertEqual(since["counts"], {"worse": 2, "better": 4, "news": 4})
        self.assertEqual([g["tone"] for g in since["groups"]], ["worse", "better", "news"])
        cards = {c["jobId"]: c for col in t["board"] for c in col["jobs"]}
        self.assertEqual([c["short"] for c in cards["J-1031"]["changes"]][0], "Drywall done")
        self.assertIn("Now at risk", [c["short"] for c in cards["J-1036"]["changes"]])
        self.assertEqual(cards["J-1038"]["changes"], [])

    def test_older_snapshot_without_changes_still_renders(self):
        from dashboard.portfolio import build_team_view

        snap = snapshot()
        del snap["portfolio"]["changes"]
        since = build_team_view(snap, assumptions())["since"]
        self.assertEqual(since["total"], 0)
        self.assertIsNone(since["sinceLabel"])

    def test_today_queue_puts_blockers_first(self):
        q = self.view()["queue"]
        levels = [i["level"] for i in q]
        self.assertEqual(levels, sorted(levels, key=lambda level: level != "blocked"))
        self.assertEqual(q[0]["dueLabel"], "Overdue")  # oldest blocker first: the trusses should have been ordered Mar 2
        self.assertIn("day-maria", [i["id"] for i in q if i["level"] == "blocked"])

    def test_lookahead_flags_conflicts_on_the_right_day(self):
        days = {d["label"]: d for d in self.view()["lookahead"]}
        crews = [e for e in days["Tomorrow"]["events"] if e["kind"] == "Crew"]
        self.assertEqual({e["jobId"] for e in crews}, {"J-1036", "J-1019"})
        self.assertTrue(all(e["flag"] == "blocked" for e in crews))
        tile = [e for e in days["Tue, Mar 24"]["events"] if e["jobId"] == "J-1045"][0]
        self.assertIn("insurance lapses first", tile["note"])

    def test_timeline_orders_worst_first_and_marks_late(self):
        rows = self.view()["timeline"]["rows"]
        self.assertEqual(rows[0]["jobId"], "J-1019")
        self.assertIn("late", [m["state"] for m in rows[0]["points"]])

    def test_team_ledger_counts_drafts(self):
        ledger = self.view()["ledger"]
        self.assertEqual(ledger["reviewMinutes"], 16)  # 15 drafts + the brief
        self.assertEqual(ledger["netMinutes"], ledger["manualMinutes"] - 16)


class NewBuildTest(unittest.TestCase):
    def view(self):
        from dashboard.portfolio import build_team_view

        return build_team_view(snapshot(), assumptions())

    def test_draw_request_goes_to_the_lender_with_its_own_button(self):
        item = next(i for i in self.view()["queue"] if i["kindLabel"] == "Loan draw")
        self.assertEqual(item["to"], "draws@granitevalley.example")
        self.assertEqual(item["channel"], "Draw request")
        self.assertEqual(item["action"], "Approve draw request")
        self.assertEqual(item["amount"], 82200)
        self.assertEqual(item["minutes"], 25)

    def test_lookahead_shows_order_deadlines_and_selections(self):
        events = [e for d in self.view()["lookahead"] for e in d["events"]]
        kinds = {(e["kind"], e["title"]) for e in events}
        self.assertIn(("Order by", "Cabinets"), kinds)  # Mar 13 = Apr 24 minus 42 days
        self.assertIn(("Selections", "Exterior colors and roofing"), kinds)

    def test_job_cards_show_lot_and_closing(self):
        cards = {c["jobId"]: c for col in self.view()["board"] for c in col["jobs"]}
        self.assertEqual(cards["J-1050"]["lot"], "Lot 14 · Ridgeview")
        self.assertEqual(cards["J-1050"]["closingLabel"], "Fri, Jun 26")
        self.assertEqual(cards["J-1050"]["lender"], "Granite Valley Bank (FAKE)")
        self.assertIsNone(cards["J-1031"]["closingLabel"])  # remodels stay as they were

    def test_ledger_names_the_new_build_work(self):
        tasks = {line["task"] for line in self.view()["ledger"]["lines"]}
        for task in ("Assemble a construction-loan draw request", "Chase a buyer for selections", "Check and place a long-lead order", "Check a closing date against the schedule"):
            self.assertIn(task, tasks)


class BriefTest(unittest.TestCase):
    def test_team_brief_leads_with_blockers_and_lists_every_job(self):
        from dashboard.brief import build_brief

        text = build_brief(snapshot(), assumptions())
        self.assertTrue(text.startswith("*Good morning. Thu, Mar 12.*"))
        self.assertIn("*Needs you first*", text)
        for job in ("J-1019", "J-1027", "J-1031", "J-1036", "J-1038", "J-1042", "J-1045", "J-1047"):
            self.assertIn(job, text)
        jobs = text[text.index("*Jobs*"):]
        self.assertLess(jobs.index("J-1019"), jobs.index("J-1031"))  # behind before on track
        self.assertIn("Tomas Reyes is at 37 of 40 h", text)

    def test_brief_says_what_changed_since_yesterday(self):
        from dashboard.brief import build_brief

        text = build_brief(snapshot(), assumptions())
        since = text[text.index("*Since yesterday*"):text.index("*Needs you first*")]
        self.assertIn("2 slipped, 4 moved forward", since)
        self.assertIn("▼ J-1036 Patel garage now at risk", since)
        self.assertIn("▲ Drywall done on J-1031 Hayes basement", since)
        self.assertLess(since.index("▼"), since.index("▲"))
        self.assertNotIn("New job", since)  # news stays in the app, the brief is for what moved
        self.assertNotIn("Since yesterday", build_brief(snapshot(), assumptions(), "tomas"))  # nothing of Tomas's moved

    def test_personal_brief_only_shows_their_work(self):
        from dashboard.brief import build_brief

        text = build_brief(snapshot(), assumptions(), "tomas")
        self.assertIn("Good morning, Tomas", text)
        self.assertIn("J-1019", text)
        self.assertNotIn("J-1031", text)
        self.assertNotIn("Tomorrow · Tomorrow", text)

    def test_scheduler_posts_once_a_day_at_the_set_time(self):
        from datetime import datetime

        from dashboard.brief import start_scheduler

        clock = {"now": datetime(2026, 3, 12, 7, 0)}
        opener = RecordingOpener(*[json.dumps({"ok": True, "channel": "C1", "ts": str(n)}) for n in range(3)])
        slack = SlackConnector(SlackConfig(bot_token="xoxb", channel="C1", send_enabled=True), opener=opener)
        stop = []
        thread = start_scheduler(slack, "08:00", now=lambda: clock["now"], sleep=lambda s: stop.append(s) or (_ for _ in ()).throw(SystemExit))
        thread.join(1)
        tick = thread.tick
        self.assertFalse(tick())                      # 07:00, too early
        clock["now"] = datetime(2026, 3, 12, 8, 0)
        self.assertTrue(tick())                       # 08:00, posts
        clock["now"] = datetime(2026, 3, 12, 8, 30)
        self.assertFalse(tick())                      # same day, no repeat
        clock["now"] = datetime(2026, 3, 13, 8, 1)
        self.assertTrue(tick())                       # next morning
        self.assertEqual([r["result"] for r in slack.audit], ["sent", "sent"])
        self.assertIn("Good morning", json.loads(opener.requests[0].data)["text"])

    def test_scheduler_skips_a_brief_that_was_due_before_startup(self):
        from datetime import datetime

        from dashboard.brief import start_scheduler

        slack = SlackConnector(SlackConfig())
        thread = start_scheduler(slack, "08:00", now=lambda: datetime(2026, 3, 12, 9, 30), sleep=lambda s: (_ for _ in ()).throw(SystemExit))
        thread.join(1)
        self.assertFalse(thread.tick())
        self.assertEqual(slack.audit, [])


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
        self.assertIn('id="tab-today"', html)
        self.assertIn('"mode": "static"', html)
        self.assertNotIn("<form", html)
        self.assertNotIn('href="/', html)
        self.assertNotIn("<link", html)


if __name__ == "__main__":
    unittest.main()
