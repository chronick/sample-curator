"""Smoke tests for ml_worker.py (vault-347l Phase 2 slice 3).

The worker is a separate Python process that the frozen sidecar drives
over stdin/stdout. These tests invoke it as a subprocess to verify the
JSON-RPC protocol, lifecycle methods, and the not-implemented stubs
respond as documented. Slice 4 will replace the stubs and add real
inference tests.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

WORKER_PATH = Path(__file__).resolve().parent.parent / "ml_worker.py"


def _send(proc: subprocess.Popen[str], method: str, params: dict | None = None, request_id: int = 1) -> dict:
    """Write a JSON-RPC request and read one line of response."""
    assert proc.stdin is not None and proc.stdout is not None
    req = {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": request_id}
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    assert line, f"no response for {method}"
    return json.loads(line)


@pytest.fixture
def worker():
    proc = subprocess.Popen(
        [sys.executable, str(WORKER_PATH)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        yield proc
    finally:
        # Best-effort clean shutdown; fall back to kill.
        try:
            if proc.poll() is None:
                _send(proc, "shutdown")
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


class TestProtocol:
    def test_ping_returns_pong(self, worker):
        resp = _send(worker, "ping")
        assert resp["jsonrpc"] == "2.0"
        assert resp["id"] == 1
        assert resp["result"] == "pong"

    def test_unknown_method_returns_method_not_found(self, worker):
        resp = _send(worker, "no_such_method")
        assert "error" in resp
        assert resp["error"]["code"] == -32601

    def test_malformed_json_returns_parse_error(self, worker):
        assert worker.stdin is not None and worker.stdout is not None
        worker.stdin.write("not json at all\n")
        worker.stdin.flush()
        line = worker.stdout.readline()
        resp = json.loads(line)
        assert resp["error"]["code"] == -32700
        # id should be null per JSON-RPC spec for parse errors
        assert resp["id"] is None

    def test_handler_exception_returns_application_error(self, worker):
        # load_model requires model_id + kind; calling without them
        # raises TypeError, which the dispatcher should map to -32000.
        resp = _send(worker, "load_model", {})
        assert "error" in resp
        assert resp["error"]["code"] == -32000


class TestLifecycle:
    def test_system_info_includes_python_and_libs(self, worker):
        resp = _send(worker, "system_info")
        info = resp["result"]
        assert "python_version" in info
        assert "available_libs" in info
        # Each tracked lib should report a bool
        for name in ("torch", "transformers", "laion_clap", "faster_whisper", "demucs"):
            assert name in info["available_libs"]
            assert isinstance(info["available_libs"][name], bool)

    def test_load_model_records_intent(self, worker):
        resp = _send(
            worker,
            "load_model",
            {"model_id": "openai/whisper-tiny", "kind": "transcription", "backend": "hf"},
        )
        loaded = resp["result"]
        assert loaded["kind"] == "transcription"
        assert loaded["model_id"] == "openai/whisper-tiny"
        assert loaded["backend"] == "hf"

    def test_loaded_model_reflects_load(self, worker):
        _send(
            worker,
            "load_model",
            {"model_id": "Qwen/Qwen2.5-0.5B-Instruct", "kind": "llm", "backend": "hf"},
            request_id=1,
        )
        resp = _send(worker, "loaded_model", request_id=2)
        snap = resp["result"]
        assert snap["model_id"] == "Qwen/Qwen2.5-0.5B-Instruct"
        assert snap["kind"] == "llm"

    def test_unload_clears_state(self, worker):
        _send(
            worker,
            "load_model",
            {"model_id": "facebook/htdemucs", "kind": "stems", "backend": "hf"},
        )
        _send(worker, "unload_model", request_id=2)
        resp = _send(worker, "loaded_model", request_id=3)
        assert resp["result"] == {}

    def test_shutdown_exits_cleanly(self, worker):
        resp = _send(worker, "shutdown")
        assert resp["result"] == "bye"
        worker.wait(timeout=5)
        assert worker.returncode == 0


class TestStubs:
    """Per-kind inference handlers (embed_clap, transcribe_whisper, separate_demucs)
    are now implemented in slice 4b. They return soft-error payloads when
    model files are missing (since the tests don't download weights)."""

    @pytest.mark.parametrize(
        "method, params, result_key",
        [
            ("embed_clap", {"model_id": "laion/clap-htsat-unfused", "audio_path": "/tmp/x.wav"}, "results"),
            ("transcribe_whisper", {"model_id": "openai/whisper-tiny", "audio_path": "/tmp/x.wav"}, "transcript"),
            (
                "separate_demucs",
                {"model_id": "facebook/htdemucs", "audio_path": "/tmp/x.wav", "output_dir": "/tmp"},
                "stems",
            ),
        ],
    )
    def test_inference_handlers_return_soft_error_when_models_missing(self, worker, method, params, result_key):
        # Handlers are implemented but models aren't downloaded in tests.
        # They should return a soft-error payload (result_key=None, error=message)
        # instead of raising.
        resp = _send(worker, method, params)
        assert "result" in resp, f"got error: {resp.get('error')}"
        result = resp["result"]
        assert result.get(result_key) is None
        assert "error" in result
        # Error should indicate missing config.json or similar, not an exception


class TestRefineLlmHf:
    """``refine_llm_hf`` is real in slice 4. The worker either loads
    the model from disk and runs inference, or returns a soft-error
    payload (``{"text": null, "error": ...}``) when prerequisites
    aren't met. We can't run the full model in CI without weights, so
    these tests cover the soft-error branches and the response shape."""

    def test_missing_snapshot_returns_soft_error(self, worker):
        # Use a model_id that no Settings download has produced —
        # snapshot dir won't exist, worker should return error not raise.
        resp = _send(
            worker,
            "refine_llm_hf",
            {"model_id": "nonexistent/model-for-test", "prompt": "hi"},
        )
        assert "result" in resp, f"got error: {resp.get('error')}"
        result = resp["result"]
        assert result.get("text") is None
        assert "error" in result
        # Either the snapshot is missing, or transformers itself is missing —
        # both are valid soft-error paths and surface a useful message.
        assert (
            "config.json" in result["error"]
            or "transformers" in result["error"]
            or "torch" in result["error"]
        )
