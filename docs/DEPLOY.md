# Put Benchmark online with Render

The dashboard runs as a website that works on a MacBook, iPad, or iPhone. `render.yaml` holds the whole setup.

## First deploy (about 5 minutes, works from a phone)

1. Sign in at [dashboard.render.com](https://dashboard.render.com).
2. Tap **New** → **Blueprint**.
3. Connect GitHub when Render asks. Give it access to **saltylvn/benchmark-ai** only.
4. Pick **benchmark-ai** and tap **Apply** (or **Deploy Blueprint**). Leave the optional settings empty.
5. Wait for **Live**, which takes 2–4 minutes. Your site is `https://benchmark-XXXX.onrender.com`.
6. Open it and tap **View the demo**.

Every merge to `main` redeploys on its own.

## What the free plan means

- **Sleep:** after 15 minutes with no visitors the site sleeps. The next visitor waits about a minute while it wakes up. Open it a minute before a meeting.
- **Approvals reset:** approvals reset when the site restarts or redeploys. Demo visitors always start fresh anyway.
- **8:00 brief:** the brief can't be relied on while the site sleeps, so `BRIEF_AT` is left off.
- **Upgrade:** switch the plan to **Starter** in Render, about $7 a month on their pricing page. The site then stays awake. Add a disk mounted at `/var/data` and set `DASHBOARD_STATE_DIR=/var/data` to keep approvals.

## Turn on Ask Benchmark (Claude)

1. Create an API key at [platform.claude.com](https://platform.claude.com) under **API keys**. Add a small monthly spend limit under **Billing**, for example $20.
2. In Render under **Environment**, set `ANTHROPIC_API_KEY` to the key. Do not paste it anywhere else.
3. After the restart, the **Ask Benchmark** card on Today takes questions.

**Limits that protect the bill:**
- Demo visitors get 8 questions per session, and signed-in users get 40.
- Everyone together gets `ASK_DAILY_LIMIT` per day (default 300).
- Each question is capped at 300 characters.

**Cost:** each answer is roughly a few cents. This morning's data is cached between questions, which keeps repeat questions cheap.

**Trust:** Claude sees only this morning's check. Before an answer is shown, every dollar amount, date, percentage and job number in it is checked against that data. If any of them can't be found, the answer is withheld.

## Sign in with Google (free)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named `Benchmark`.
2. Open **APIs & Services → OAuth consent screen**. Choose **External**, set the app name to `Benchmark`, add your email, and save. Under **Test users**, add each person who should sign in.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URI: `https://benchmark-qypb.onrender.com/auth/google/callback`
4. Copy the **Client ID** and **Client secret** into Render under **Environment**, as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. In the same place, set `ALLOWED_EMAILS` to the addresses that may sign in, separated by commas. Use `ALLOWED_EMAIL_DOMAINS` instead if everyone shares a company domain.

## Slack: sign-in and posting from one app (free)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Name it `Benchmark` and pick your workspace.
2. Under **OAuth & Permissions**:
   - Redirect URL: `https://benchmark-qypb.onrender.com/auth/slack/callback`
   - Add these **User Token Scopes**, for sign-in: `openid`, `email`, `profile`
   - Add this **Bot Token Scope**, for posting: `chat:write`
3. Tap **Install to Workspace** and allow it. Copy the **Bot User OAuth Token**, which starts with `xoxb-`.
4. Under **Basic Information**, copy the **Client ID** and **Client Secret**.
5. In Slack, create a channel such as `#benchmark`. Type `/invite @Benchmark` there. Open the channel details and copy the **Channel ID**, which starts with `C`.
6. In Render under **Environment**, set:
   - `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`: sign in with Slack.
   - `SLACK_BOT_TOKEN` and `SLACK_CHANNEL`: the dashboard shows Slack as connected.
   - `SLACK_SEND_ENABLED=1`: only when you want a signed-in PM's approval to post for real. Demo visitors never post.

Never paste these secrets into chat, email, or the repo. They belong only in Render's Environment tab.

## Every setting

Everything is optional. Fill these in under the service's **Environment** tab, and Render restarts the site.

| Setting | What it does |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google. Set the redirect URI to `https://<your-site>/auth/google/callback`. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Sign in with Slack. Callback: `/auth/slack/callback`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Sign in with Microsoft 365. Callback: `/auth/microsoft/callback`. |
| `ALLOWED_EMAIL_DOMAINS` | Only these email domains can sign in, for example `summitridge.com`. |
| `ALLOWED_EMAILS` | Only these exact addresses can sign in. Use it when the team signs in with personal Gmail. |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` | Connects Slack. Previews only, until the next line is set. |
| `SLACK_SEND_ENABLED=1` | Lets a signed-in PM's approval actually post. Demo visitors never post. |

The site works out its own public address from Render (`RENDER_EXTERNAL_URL`). Sign-in links and secure cookies use https automatically. Set `PUBLIC_URL` only if you add your own domain.
