"""WorkerManager — drives the runtime-venv ``ml_worker.py`` subprocess
(vault-347l Phase 2 slice 4).

The bundled sidecar can't pip-install heavy ML libraries at runtime, so
we delegate model loading + inference to a subprocess that runs from
the user's runtime venv at
``~/.music-hub-data/python/runtime/.venv/`` (created by the Rust
``deps_install`` Tauri command).

Lifecycle: lazy spawn on first call, restart on death, single-process
single-model invariant. Inference calls are serialized via a mutex so
two threads can't interleave reads/writes on the worker's stdio.

If the runtime venv doesn't exist yet, ``available()`` returns False
and callers can fall back to in-process loading (dev path; the sidecar
venv may have the libs).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

# Conventional location set by the Rust deps_install command.
RUNTIME_VENV_PYTHON = (
    Path.home() / ".music-hub-data" / "python" / "runtime" / ".venv" / "bin" / "python"
)


def _resolve_worker_script() -> Optional[Path]:
    """Find ``ml_worker.py`` regardless of whether we're frozen or running
    from source.

    PyInstaller exposes bundled data files at ``sys._MEIPASS``; we add
    ``ml_worker.py`` to ``datas`` in ``sample-curation-api.spec`` (slice
    4 update) so it lives there in prod. In dev, the file lives at
    ``sidecar/ml_worker.py`` next to the package directory.

    Also accepts the env-var override ``SAMPLE_CURATOR_ML_WORKER_PATH``
    so tests / Rust can point the sidecar at a known-good copy without
    relying on the package layout.
    """
    if env_override := os.environ.get("SAMPLE_CURATOR_ML_WORKER_PATH"):
        p = Path(env_override)
        if p.exists():
            return p
        log.warning("SAMPLE_CURATOR_ML_WORKER_PATH=%s does not exist", env_override)

    if hasattr(sys, "_MEIPASS"):
        # PyInstaller frozen layout. ``ml_worker.py`` is bundled as data.
        candidate = Path(sys._MEIPASS) / "ml_worker.py"  # type: ignore[attr-defined]
        if candidate.exists():
            return candidate

    # Dev: sidecar/ml_worker.py sits next to the package directory.
    candidate = Path(__file__).resolve().parent.parent / "ml_worker.py"
    if candidate.exists():
        return candidate

    return None


def _resolve_python() -> Optional[Path]:
    """Pick the interpreter to spawn the worker under.

    Preference order:
    1. Runtime venv at ``~/.music-hub-data/python/runtime/.venv`` —
       this is the only path that works in production. Created by
       the Rust deps_install command after the user clicks Install.
    2. ``sys.executable`` — dev fallback so you can use the worker
       path from a normal ``uv sync``'d sidecar venv. In prod (frozen
       PyInstaller) sys.executable is the bundled binary, which lacks
       transformers/torch, so this branch only helps dev.
    """
    if RUNTIME_VENV_PYTHON.exists():
        return RUNTIME_VENV_PYTHON

    # Frozen sidecars never have the heavy libs in their bundled
    # interpreter, so don't fall back there.
    if getattr(sys, "frozen", False):
        return None

    return Path(sys.executable)


def available() -> bool:
    """Cheap probe: can a worker be spawned right now? True iff the
    runtime venv has been created. Dev fall-through (``sys.executable``)
    intentionally excluded — callers preferring in-process loading on
    dev should check ``runtime_venv_exists()`` and fall back themselves.
    """
    return RUNTIME_VENV_PYTHON.exists()


def runtime_venv_exists() -> bool:
    """Distinct from ``available()`` for symmetry with the Rust side
    (``deps::runtime_venv_ready()``). Same condition; future divergence
    (e.g. version compat checks) goes here."""
    return RUNTIME_VENV_PYTHON.exists()


class WorkerError(RuntimeError):
    """Raised when the worker subprocess can't be spawned or returns an error."""


class WorkerManager:
    """Single-instance manager for the ml_worker subprocess.

    All public methods are thread-safe; calls are serialized via
    ``self._call_lock`` because the worker speaks line-delimited
    JSON-RPC and interleaved writes would corrupt requests.
    """

    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen[str]] = None
        self._call_lock = threading.Lock()
        self._spawn_lock = threading.Lock()
        self._next_id = 1

    # ---- spawn / health ----

    def _ensure_alive(self) -> None:
        """Spawn the worker subprocess if dead/missing. Runs under
        ``self._spawn_lock`` so concurrent first-callers don't race."""
        with self._spawn_lock:
            if self._proc is not None and self._proc.poll() is None:
                return  # already running

            python_path = _resolve_python()
            if python_path is None:
                raise WorkerError(
                    "Runtime ML deps not installed. Install via Settings → "
                    "Analysis & ML → Install dependencies."
                )

            worker_script = _resolve_worker_script()
            if worker_script is None:
                raise WorkerError(
                    "ml_worker.py not found. Set SAMPLE_CURATOR_ML_WORKER_PATH "
                    "or reinstall Sample Curator."
                )

            log.info(
                "spawning ml_worker: python=%s script=%s",
                python_path,
                worker_script,
            )
            self._proc = subprocess.Popen(
                [str(python_path), str(worker_script)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

    # ---- core RPC ----

    def call(self, method: str, params: Optional[dict] = None, *, timeout: float | None = None) -> Any:
        """Send a JSON-RPC request and block until the response.

        ``timeout`` is best-effort: we have no native deadline on
        ``readline``, so a stuck worker will still hang. v2 will move
        to ``select.select`` with a deadline if this becomes a problem.
        """
        with self._call_lock:
            self._ensure_alive()
            assert self._proc is not None and self._proc.stdin is not None and self._proc.stdout is not None

            request_id = self._next_id
            self._next_id += 1
            request = {
                "jsonrpc": "2.0",
                "method": method,
                "params": params or {},
                "id": request_id,
            }

            try:
                self._proc.stdin.write(json.dumps(request) + "\n")
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError) as e:
                # Worker died mid-write. Reap it so the next call respawns.
                self._reap()
                raise WorkerError(f"worker died on stdin write: {e}") from e

            line = self._proc.stdout.readline()
            if not line:
                # EOF — worker exited.
                stderr = ""
                if self._proc.stderr is not None:
                    try:
                        stderr = self._proc.stderr.read() or ""
                    except Exception:
                        pass
                self._reap()
                raise WorkerError(
                    f"worker exited without responding to {method}. stderr: {stderr.strip()}"
                )

            try:
                response = json.loads(line)
            except json.JSONDecodeError as e:
                self._reap()
                raise WorkerError(f"worker returned non-JSON: {line!r} ({e})") from e

            if "error" in response:
                err = response["error"]
                raise WorkerError(f"worker.{method}: {err.get('message', err)}")
            return response.get("result")

    # ---- lifecycle ----

    def shutdown(self) -> None:
        """Politely ask the worker to exit, then reap. Safe to call
        when no worker is alive."""
        if self._proc is None or self._proc.poll() is not None:
            self._proc = None
            return
        try:
            with self._call_lock:
                if self._proc is not None and self._proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "method": "shutdown",
                        "params": {},
                        "id": self._next_id,
                    }
                    self._next_id += 1
                    if self._proc.stdin is not None:
                        try:
                            self._proc.stdin.write(json.dumps(request) + "\n")
                            self._proc.stdin.flush()
                        except (BrokenPipeError, OSError):
                            pass
                    self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        finally:
            self._reap()

    def _reap(self) -> None:
        """Best-effort cleanup of the subprocess regardless of state."""
        if self._proc is None:
            return
        if self._proc.poll() is None:
            self._proc.kill()
        self._proc = None


# ---- module-level singleton ----

_INSTANCE: Optional[WorkerManager] = None
_INSTANCE_LOCK = threading.Lock()


def get_worker() -> WorkerManager:
    global _INSTANCE
    with _INSTANCE_LOCK:
        if _INSTANCE is None:
            _INSTANCE = WorkerManager()
        return _INSTANCE


def reset_worker() -> None:
    """Tear down the singleton — used by tests and a future ``Reload
    worker`` debug action. Safe to call repeatedly."""
    global _INSTANCE
    with _INSTANCE_LOCK:
        if _INSTANCE is not None:
            _INSTANCE.shutdown()
            _INSTANCE = None
