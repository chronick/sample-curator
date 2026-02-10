"""Shared fixtures for sample-curation-api tests."""

import pytest


@pytest.fixture
def jsonrpc_request():
    """Factory for JSON-RPC request dicts."""

    def _make(method: str, params: dict | None = None, request_id: int = 1) -> dict:
        req = {"jsonrpc": "2.0", "method": method, "id": request_id}
        if params is not None:
            req["params"] = params
        return req

    return _make
