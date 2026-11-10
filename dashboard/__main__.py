import os
import socket
from pathlib import Path

from .app import create_app


def load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from .env without overriding the real environment."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def lan_address() -> str | None:
    """Best guess at this machine's Wi-Fi address. Sends no packets."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            return probe.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    load_dotenv(Path.cwd() / ".env")
    host = os.environ.get("DASHBOARD_HOST", "127.0.0.1")
    port = int(os.environ.get("DASHBOARD_PORT", "5050"))
    print(f"Benchmark dashboard on http://127.0.0.1:{port}")
    if host in ("0.0.0.0", "::"):
        address = lan_address()
        if address:
            print(f"On an iPhone or iPad on the same Wi-Fi, open http://{address}:{port}")
    else:
        print("To open it on an iPhone or iPad on this Wi-Fi, restart with DASHBOARD_HOST=0.0.0.0")
    from .store import DEFAULT_STATE_DIR

    app = create_app(state_dir=os.environ.get("DASHBOARD_STATE_DIR") or DEFAULT_STATE_DIR)
    brief_at = os.environ.get("BRIEF_AT", "").strip()
    if brief_at:
        from .brief import start_scheduler

        start_scheduler(app.extensions["slack"], brief_at)
        print(f"Morning brief posts to Slack daily at {brief_at} (sends only if SLACK_SEND_ENABLED=1).")
    app.run(host=host, port=port, debug=os.environ.get("FLASK_DEBUG") == "1", use_reloader=False)
