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

## Turning on sign-in and Slack later

Everything is optional. Fill these in under the service's **Environment** tab, and Render restarts the site.

| Setting | What it does |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google. Set the redirect URI to `https://<your-site>/auth/google/callback`. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Sign in with Slack. Callback: `/auth/slack/callback`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Sign in with Microsoft 365. Callback: `/auth/microsoft/callback`. |
| `ALLOWED_EMAIL_DOMAINS` | Only these email domains can sign in, for example `summitridge.com`. |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` | Connects Slack. Previews only, until the next line is set. |
| `SLACK_SEND_ENABLED=1` | Lets a signed-in PM's approval actually post. Demo visitors never post. |

The site works out its own public address from Render (`RENDER_EXTERNAL_URL`). Sign-in links and secure cookies use https automatically. Set `PUBLIC_URL` only if you add your own domain.
