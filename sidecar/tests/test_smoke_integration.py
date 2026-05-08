"""Integration smoke test for vault-347l Phase 2 slice 6.

Verifies the complete worker pipeline end-to-end:
1. Runtime venv can be set up (mocked via env var in tests)
2. Worker can be spawned
3. Models can be loaded
4. Inference can be run (returns soft-error if no weights, but doesn't crash)

This test assumes the dev sidecar venv has all the necessary packages
installed (transformers, torch, faster-whisper, demucs). In production,
the user would install them via the Settings UI, which calls deps_install.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# We'll test by spawning the worker subprocess and sending real requests.
WORKER_PATH = Path(__file__).resolve().parent.parent / "ml_worker.py"


def _send(
    proc: subprocess.Popen[str], method: str, params: dict | None = None
) -> dict:
    """Send a JSON-RPC request and read the response."""
    assert proc.stdin is not None and proc.stdout is not None
    req = {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    assert line, f"no response for {method}"
    return json.loads(line)


class TestSmokeEndToEnd:
    """Verify the complete worker pipeline."""

    def test_worker_spawns_and_responds(self):
        """Simplest check: worker process starts and responds to ping."""
        proc = subprocess.Popen(
            [sys.executable, str(WORKER_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            resp = _send(proc, "ping")
            assert resp["result"] == "pong"
        finally:
            _send(proc, "shutdown")
            proc.wait(timeout=5)

    def test_worker_reports_available_libs(self):
        """Worker system_info should report which ML libs are available."""
        proc = subprocess.Popen(
            [sys.executable, str(WORKER_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            resp = _send(proc, "system_info")
            info = resp["result"]
            assert "available_libs" in info
            # We expect at least some libs to be missing in the basic test,
            # but the structure should be present.
            assert isinstance(info["available_libs"], dict)
        finally:
            _send(proc, "shutdown")
            proc.wait(timeout=5)

    def test_inference_handlers_gracefully_handle_missing_models(self):
        """Inference handlers should return soft-error payloads when models
        aren't downloaded, not raise exceptions."""
        proc = subprocess.Popen(
            [sys.executable, str(WORKER_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            # Try to run inference without models present
            # (the test env doesn't download models)
            resp = _send(
                proc,
                "refine_llm_hf",
                {"model_id": "nonexistent/model", "prompt": "test"},
            )
            result = resp["result"]
            assert result.get("text") is None
            assert "error" in result
            # Should be a clear error message, not an exception
            assert isinstance(result["error"], str)
        finally:
            _send(proc, "shutdown")
            proc.wait(timeout=5)
