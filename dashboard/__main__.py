import os
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


if __name__ == "__main__":
    load_dotenv(Path.cwd() / ".env")
    host = os.environ.get("DASHBOARD_HOST", "127.0.0.1")
    port = int(os.environ.get("DASHBOARD_PORT", "5050"))
    create_app().run(host=host, port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
