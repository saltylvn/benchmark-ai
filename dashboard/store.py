"""Small durable state for the dashboard: approvals and the Slack log.

Plain JSON on disk, written atomically under a lock, so a restart keeps who
approved what. Swap for a database when the dashboard serves more than one
office; the interface stays the same.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from .insights import HERE

DEFAULT_STATE_DIR = HERE / "var"


class JsonStore:
    def __init__(self, path: Path | str | None):
        self.path = Path(path) if path else None
        self._lock = threading.Lock()
        self._data: dict[str, Any] = self._read()

    def _read(self) -> dict[str, Any]:
        if not self.path or not self.path.is_file():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            # A damaged file should not take the dashboard down; start clean and keep the bad copy.
            self.path.rename(self.path.with_suffix(".corrupt.json"))
            return {}

    def _write(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return json.loads(json.dumps(self._data.get(key, default)))

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._write()

    def update(self, key: str, inner: str, value: Any) -> None:
        with self._lock:
            self._data.setdefault(key, {})[inner] = value
            self._write()

    def put_in(self, path: list[str], value: Any) -> None:
        """Set data[path[0]][path[1]]...[path[-1]] = value in one locked write."""
        with self._lock:
            node = self._data
            for part in path[:-1]:
                node = node.setdefault(part, {})
            node[path[-1]] = value
            self._write()

    def append(self, key: str, value: Any, keep: int = 200) -> None:
        with self._lock:
            items = self._data.setdefault(key, [])
            items.append(value)
            del items[:-keep]
            self._write()
