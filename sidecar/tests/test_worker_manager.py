"""Tests for WorkerManager (vault-347l Phase 2 slice 4).

The worker subprocess itself is covered in test_ml_worker.py. This file
exercises the manager's lifecycle (lazy spawn, mutex, restart on death,
shutdown) using a small synthetic worker script that doesn't import
any ML libs.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from sample_curation_api import worker_manager


@pytest.fixture
def fake_worker_script(tmp_path: Path, monkeypatch) -> Path:
    """Tiny worker that handles ``ping`` / ``echo`` / ``boom`` /
    ``shutdown`` so we can drive the manager without loading torch."""
    script = tmp_path / "fake_ml_worker.py"
    script.write_text(
        textwrap.dedent(
            """
            import json, sys, traceback

            def _handle(req):
                method = req.get("method")
                rid = req.get("id")
                params = req.get("params") or {}
                if method == "ping":
                    return {"jsonrpc": "2.0", "result": "pong", "id": rid}
                if method == "echo":
                    return {"jsonrpc": "2.0", "result": params.get("payload"), "id": rid}
                if method == "boom":
                    return {
                        "jsonrpc": "2.0",
                        "error": {"code": -32000, "message": "kaboom"},
                        "id": rid,
                    }
                if method == "die":
                    sys.exit(7)
                if method == "shutdown":
                    return {"jsonrpc": "2.0", "result": "bye", "id": rid}
                return {
                    "jsonrpc": "2.0",
                    "error": {"code": -32601, "message": "no such method"},
                    "id": rid,
                }

            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except Exception as e:
                    print(json.dumps({"jsonrpc": "2.0", "error": {"code": -32700, "message": str(e)}, "id": None}), flush=True)
                    continue
                resp = _handle(req)
                print(json.dumps(resp), flush=True)
                if req.get("method") == "shutdown":
                    break
            """
        ).strip()
    )

    monkeypatch.setenv("SAMPLE_CURATOR_ML_WORKER_PATH", str(script))
    # Force the dev-fallback python (sys.executable) by ensuring the
    # runtime venv path doesn't exist. _resolve_python only checks
    # whether RUNTIME_VENV_PYTHON exists; tmp_path stays clean.
    monkeypatch.setattr(
        worker_manager,
        "RUNTIME_VENV_PYTHON",
        tmp_path / "definitely-not-here" / "python",
    )

    worker_manager.reset_worker()
    yield script
    worker_manager.reset_worker()


class TestSpawnAndCall:
    def test_lazy_spawn_on_first_call(self, fake_worker_script):
        wm = worker_manager.get_worker()
        # No proc until first call
        assert wm._proc is None
        result = wm.call("ping")
        assert result == "pong"
        assert wm._proc is not None
        assert wm._proc.poll() is None  # still alive

    def test_singleton(self, fake_worker_script):
        a = worker_manager.get_worker()
        b = worker_manager.get_worker()
        assert a is b

    def test_echo_round_trip(self, fake_worker_script):
        wm = worker_manager.get_worker()
        assert wm.call("echo", {"payload": "hello"}) == "hello"
        assert wm.call("echo", {"payload": [1, 2, 3]}) == [1, 2, 3]

    def test_request_ids_increment(self, fake_worker_script):
        wm = worker_manager.get_worker()
        wm.call("ping")
        wm.call("ping")
        wm.call("ping")
        # Internal counter went from 1 → 4 over three calls.
        assert wm._next_id == 4


class TestErrors:
    def test_worker_error_surfaces_message(self, fake_worker_script):
        wm = worker_manager.get_worker()
        with pytest.raises(worker_manager.WorkerError) as exc_info:
            wm.call("boom")
        assert "kaboom" in str(exc_info.value)

    def test_worker_dying_raises_workererror_and_reaps(self, fake_worker_script):
        wm = worker_manager.get_worker()
        wm.call("ping")  # spawn
        # Send "die" — the worker exits with code 7 without responding.
        with pytest.raises(worker_manager.WorkerError):
            wm.call("die")
        # After the failure the manager should have reaped the dead proc
        # so the next call respawns cleanly.
        assert wm._proc is None
        assert wm.call("ping") == "pong"

    def test_unknown_method_surfaces(self, fake_worker_script):
        wm = worker_manager.get_worker()
        with pytest.raises(worker_manager.WorkerError):
            wm.call("not_a_method")


class TestAvailability:
    def test_available_false_when_runtime_venv_missing(self, fake_worker_script):
        # Fixture monkeypatches RUNTIME_VENV_PYTHON to a non-existent path.
        assert worker_manager.available() is False
        assert worker_manager.runtime_venv_exists() is False

    def test_available_true_when_runtime_venv_present(self, tmp_path, monkeypatch):
        fake_python = tmp_path / "fake-python"
        fake_python.write_text("#!/bin/sh\nexit 0\n")
        fake_python.chmod(0o755)
        monkeypatch.setattr(worker_manager, "RUNTIME_VENV_PYTHON", fake_python)
        assert worker_manager.available() is True


class TestShutdown:
    def test_shutdown_terminates_process(self, fake_worker_script):
        wm = worker_manager.get_worker()
        wm.call("ping")
        proc = wm._proc
        assert proc is not None
        wm.shutdown()
        # After shutdown the proc reference is cleared and the OS proc
        # has actually exited.
        assert wm._proc is None
        proc.wait(timeout=5)
        assert proc.returncode == 0

    def test_shutdown_when_not_started_is_noop(self, fake_worker_script):
        wm = worker_manager.get_worker()
        # Never called — _proc is None.
        wm.shutdown()
        assert wm._proc is None

    def test_reset_worker_replaces_singleton(self, fake_worker_script):
        a = worker_manager.get_worker()
        a.call("ping")
        worker_manager.reset_worker()
        b = worker_manager.get_worker()
        assert a is not b
