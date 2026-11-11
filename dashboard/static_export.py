"""Write the dashboard as one self-contained, read-only HTML file.

    python -m dashboard.static_export [out.html]

The file opens on a welcome card, then the team app (Today, Jobs, Team,
Messages, Under the hood), routed by the URL hash. It has no server calls, so it can be
hosted anywhere and opened on a phone or iPad. Approvals and sign-in stay in the
live dashboard.
"""

from __future__ import annotations

import sys
from pathlib import Path

from flask import render_template

from .app import create_app, provider_cards
from .brief import with_brief
from .portfolio import build_team_view, landing
from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, HERE, build_view, load_json, load_snapshot

STATIC_SLACK = {
    "connected": False,
    "mode": "none",
    "sendEnabled": False,
    "channel": None,
    "detail": "This copy runs without a server, so approvals stay in this browser.",
}


def render_static(
    snapshot_path: Path = DEFAULT_SNAPSHOT,
    assumptions_path: Path = DEFAULT_ASSUMPTIONS,
    template: str = "static.html",
) -> str:
    app = create_app(snapshot_path, assumptions_path, env={})
    snapshot, assumptions = load_snapshot(snapshot_path), load_json(assumptions_path)
    with app.test_request_context("/"):
        app_html = render_template(
            "_app.html",
            static_mode=True,
            v=build_view(snapshot, assumptions, "thursday"),
            t=with_brief(build_team_view(snapshot, assumptions), snapshot, assumptions),
            brief_at="08:00",
            user=None,
            slack=STATIC_SLACK,
            audit=[],
            approvals={},
            form_token="",
        )
        welcome = render_template("_welcome.html", static_mode=True, providers=provider_cards({}), landing=landing(snapshot, assumptions))
        return render_template(
            template,
            css=(HERE / "static" / "dashboard.css").read_text(encoding="utf-8"),
            app_html=app_html,
            welcome=welcome,
        )


MANIFEST = {
    "name": "Benchmark",
    "short_name": "Benchmark",
    "description": "The agent team for construction project managers: what it did, why, and what is waiting on you.",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f3f0e8",
    "theme_color": "#221f1a",
    "icons": [
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "apple-touch-icon.png", "sizes": "180x180", "type": "image/png"},
        {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml"},
    ],
}

SERVICE_WORKER = """// Benchmark offline cache. Network first, so a new export shows up; cache when there is no signal.
const CACHE = 'benchmark-%(version)s';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
"""


def build_site(out_dir: Path) -> Path:
    """Write an installable site: index.html, manifest, icons, and an offline service worker."""
    import hashlib
    import json
    import shutil

    out_dir.mkdir(parents=True, exist_ok=True)
    html = render_static(template="site.html")
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    (out_dir / "manifest.webmanifest").write_text(json.dumps(MANIFEST, indent=2) + "\n", encoding="utf-8")
    for name in ("icon.svg", "icon-512.png", "apple-touch-icon.png"):
        shutil.copyfile(HERE / "static" / name, out_dir / name)
    version = hashlib.sha256(html.encode()).hexdigest()[:10]
    (out_dir / "sw.js").write_text(SERVICE_WORKER % {"version": version}, encoding="utf-8")
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")
    return out_dir


def main(argv: list[str]) -> int:
    if argv[:1] == ["--site"]:
        out_dir = build_site(Path(argv[1] if len(argv) > 1 else "dashboard/dist/site"))
        print(f"Wrote installable site to {out_dir}/")
        return 0
    out = Path(argv[0] if argv else "dashboard/dist/benchmark-dashboard.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_static(), encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
