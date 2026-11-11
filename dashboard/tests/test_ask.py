"""Ask Benchmark: grounding, the fact check, limits, and the endpoint. No network: Claude is faked."""

import json
import unittest
from types import SimpleNamespace

from dashboard import ask as asker
from dashboard.app import create_app
from dashboard.insights import DEFAULT_SNAPSHOT, load_snapshot
from dashboard.slack import SlackConfig, SlackConnector


class FakeClaude:
    """Stands in for anthropic.Anthropic(): records requests, returns canned answers."""

    def __init__(self, *answers, stop_reason="end_turn"):
        self.answers = list(answers)
        self.stop_reason = stop_reason
        self.requests = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        text = self.answers.pop(0) if self.answers else "That isn't in this morning's check."
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=120, cache_read_input_tokens=9000, output_tokens=80),
        )


def csrf(client):
    with client.session_transaction() as s:
        return s.get("csrf") or ""


class FactCheckTest(unittest.TestCase):
    def setUp(self):
        self.context = asker.context_text(load_snapshot(DEFAULT_SNAPSHOT))

    def test_context_is_deterministic_and_carries_new_build_data(self):
        self.assertEqual(self.context, asker.context_text(load_snapshot(DEFAULT_SNAPSHOT)))
        data = json.loads(self.context)
        ridgeview = next(j for j in data["jobs"] if j["job"] == "J-1050")
        self.assertEqual(ridgeview["closing"], "2026-06-26")
        self.assertEqual(ridgeview["lender"], "Granite Valley Bank (FAKE)")
        self.assertTrue(any(i["kind"] == "draw" for i in data["issues"]))
        self.assertTrue(data["sinceYesterday"])

    def test_real_facts_pass(self):
        answer = "Ridgeview [J-1050] has an $82,200 draw ready from Granite Valley Bank. Closing is Fri, Jun 26. Hayes [J-1031] is 60% complete; trusses for [J-1051] were needed Apr 6."
        self.assertEqual(asker.check_answer(answer, self.context), [])

    def test_invented_or_summed_figures_fail(self):
        missing = asker.check_answer("Draws total $94,600 across [J-1050] and [J-9999], due Jul 4, 73% done.", self.context)
        self.assertIn("money 94600.00", missing)
        self.assertIn("job J-9999", missing)
        self.assertIn("date 07-04", missing)
        self.assertIn("percent 73", missing)

    def test_month_names_and_iso_dates_are_the_same_date(self):
        self.assertEqual(asker.check_answer("Closing is June 26 (2026-06-26).", self.context), [])


class AskCallTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = load_snapshot(DEFAULT_SNAPSHOT)

    def test_request_shape_grounded_cached_low_effort_with_fallback(self):
        claude = FakeClaude("Order cabinets for [J-1050] by Fri, Mar 13.")
        result = asker.ask(claude, self.snapshot, "What do I order this week?")
        self.assertTrue(result.ok)
        self.assertEqual(result.jobs, ["J-1050"])
        req = claude.requests[0]
        self.assertEqual(req["model"], "claude-opus-5-5")
        self.assertEqual(req["fallbacks"], "default")
        self.assertEqual(req["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(req["output_config"], {"effort": "low"})
        self.assertEqual(req["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertIn('"J-1050"', req["system"][0]["text"])
        self.assertEqual(req["messages"], [{"role": "user", "content": "What do I order this week?"}])
        self.assertEqual(result.usage, {"input": 120, "cacheRead": 9000, "output": 80})

    def test_answer_with_an_unsupported_figure_is_withheld(self):
        result = asker.ask(FakeClaude("All draws add up to $250,000."), self.snapshot, "Total draws?")
        self.assertFalse(result.ok)
        self.assertEqual(result.answer, asker.NOT_RELIABLE)
        self.assertIn("money 250000.00", result.reason)

    def test_refusal_is_reported_not_read(self):
        result = asker.ask(FakeClaude("partial", stop_reason="refusal"), self.snapshot, "?")
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "refusal")


class AskEndpointTest(unittest.TestCase):
    def make(self, claude=None, env=None):
        app = create_app(slack=SlackConnector(SlackConfig()), env=env or {}, ask_client=claude)
        client = app.test_client()
        client.get("/demo")
        client.get("/")  # the page issues the session's form token
        return app, client

    def post(self, client, question, token=None):
        return client.post("/api/ask", json={"question": question}, headers={"X-Form-Token": csrf(client) if token is None else token})

    def test_off_without_a_key_and_the_page_says_how_to_turn_it_on(self):
        _, client = self.make()
        self.assertEqual(self.post(client, "Hi").status_code, 503)
        page = client.get("/").get_data(as_text=True)
        self.assertIn("Ask Benchmark", page)
        self.assertIn("adds an Anthropic API key", page)
        self.assertNotIn("data-ask-form", page)

    def test_answers_and_logs(self):
        claude = FakeClaude("[J-1019] closing Fri, May 29 is at risk.")
        app, client = self.make(claude)
        page = client.get("/").get_data(as_text=True)
        self.assertIn("data-ask-form", page)
        body = self.post(client, "  Which closings are at risk?  ").get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["jobs"], ["J-1019"])
        self.assertEqual(claude.requests[0]["messages"][0]["content"], "Which closings are at risk?")
        log = app.extensions["store"].get("askLog")
        self.assertEqual(log[-1]["question"], "Which closings are at risk?")

    def test_needs_the_page_token_and_a_sane_question(self):
        claude = FakeClaude()
        _, client = self.make(claude)
        self.assertEqual(self.post(client, "Hi", token="forged").status_code, 400)
        self.assertEqual(self.post(client, "   ").status_code, 400)
        self.assertEqual(self.post(client, "x" * 301).status_code, 400)
        self.assertEqual(claude.requests, [])

    def test_demo_sessions_are_limited(self):
        claude = FakeClaude()
        _, client = self.make(claude)
        for _ in range(asker.SESSION_LIMIT_DEMO):
            self.assertEqual(self.post(client, "What changed?").status_code, 200)
        self.assertEqual(self.post(client, "What changed?").status_code, 429)
        self.assertEqual(len(claude.requests), asker.SESSION_LIMIT_DEMO)

    def test_daily_cap_protects_the_bill(self):
        claude = FakeClaude()
        _, client = self.make(claude, env={"ASK_DAILY_LIMIT": "1"})
        self.assertEqual(self.post(client, "One").status_code, 200)
        self.assertEqual(self.post(client, "Two").status_code, 429)
        self.assertEqual(len(claude.requests), 1)

    def test_signed_out_visitors_cannot_ask(self):
        app = create_app(slack=SlackConnector(SlackConfig()), env={}, ask_client=FakeClaude())
        response = app.test_client().post("/api/ask", json={"question": "Hi"})
        self.assertIn(response.status_code, (302, 401))


if __name__ == "__main__":
    unittest.main()
