"""Shared fixtures for sample-curation-api tests."""

import pytest


@pytest.fixture(autouse=True)
def reset_ollama_status():
    """Reset OllamaStatus singleton between tests to prevent seed leakage."""
    from sample_curation_api.ollama_status import OllamaStatus

    OllamaStatus._reset_for_tests()
    yield
    OllamaStatus._reset_for_tests()


@pytest.fixture
def seeded_ollama_model(tmp_path, monkeypatch):
    """Seed OllamaStatus with a loaded test model + mask the user's
    ml-features-config.json so legacy ollama auto-detect runs.

    The vault-3ume rework reads ``~/.music-hub-data/ml-features-config.json``
    to decide which backend to dispatch to. On a dev machine this file
    almost always exists and pins ``backend=hf``, which would short-circuit
    the legacy ollama path these tests are exercising. Pointing
    ``llm.ML_CONFIG_PATH`` at an empty tmp_path makes ``_load_active_llm_config``
    return ``config_exists=False`` → legacy path.
    """
    from sample_curation_api import llm
    from sample_curation_api.ollama_status import OllamaStatus

    monkeypatch.setattr(llm, "ML_CONFIG_PATH", tmp_path / "no-such-config.json")

    status = OllamaStatus.instance()
    with status._lock:
        status.state = "loaded"
        status.model = "test-model:latest"
    return status.model


@pytest.fixture
def jsonrpc_request():
    """Factory for JSON-RPC request dicts."""

    def _make(method: str, params: dict | None = None, request_id: int = 1) -> dict:
        req = {"jsonrpc": "2.0", "method": method, "id": request_id}
        if params is not None:
            req["params"] = params
        return req

    return _make
