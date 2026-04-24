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
def seeded_ollama_model():
    """Seed OllamaStatus with a loaded test model."""
    from sample_curation_api.ollama_status import OllamaStatus

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
