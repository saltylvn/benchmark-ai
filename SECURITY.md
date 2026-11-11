# Security

## Reporting a vulnerability

Please open a private report through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue for security problems. You'll get a reply within a few days.

## Design

Benchmark drafts work for construction teams and must never act on its own. The controls:

| Area | Control |
| --- | --- |
| **Actions** | Drafts only. Email and invoices have no send path. Slack posts need `SLACK_SEND_ENABLED=1` **and** a signed-in, named approver. Demo sessions never post or emit webhooks. |
| **AI** | Code computes every date, amount and schedule. A model may only rephrase, and `src/providers/guard.ts` rejects any rewrite that drops, changes or adds a fact. Mock mode is the default. |
| **Sign-in** | Google and Slack OAuth (authorization code with a `state` check). Only verified emails are accepted, and access is limited with `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`. The session is cleared on sign-in to prevent fixation. |
| **Sessions** | `HttpOnly`, `SameSite=Lax` cookies. On HTTPS they are also `Secure` and `__Host-` prefixed. Every state-changing request needs a per-session token (`X-Form-Token`, or a form field on sign-out). |
| **Browser** | CSP with a per-response script nonce (no inline scripts without it), `object-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, COOP/CORP `same-origin`, a restrictive `Permissions-Policy`, and HSTS on HTTPS. API responses are `no-store`. Request bodies are capped at 64 KB. |
| **Automation API** | Bearer token of 32+ characters, compared in constant time. A browser session does not unlock it. Approvals through the API need a named, allowlisted person. |
| **Webhooks** | HMAC-SHA256 over `timestamp.body` with a 5-minute replay window, https-only receivers, query strings redacted from logs, and bounded retries. |
| **Secrets** | Environment variables only (Render, GitHub Actions secrets). `.env` is gitignored, and `.env.example` holds no values. The git history was scanned for keys before going public. |
| **Supply chain** | No runtime npm dependencies, and small pinned ranges for Python. Dependabot is enabled for npm, pip and Actions. CI runs `pip-audit` and `npm audit`. CodeQL scans the code once the repository is public. |

## Known limits

- State is a JSON file behind one worker. That suits a demo or a small team; the `JsonStore` interface is the seam for moving to Postgres.
- There is no application-level rate limiting yet. Sign-in relies on the identity provider, and the automation API relies on token strength.
