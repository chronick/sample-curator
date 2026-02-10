"""Tests for sample_curation_api JSON-RPC handling."""

from sample_curation_api import handle_request


class TestHandleRequest:
    def test_valid_ping_request(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("ping"))
        assert response["jsonrpc"] == "2.0"
        assert response["result"] == "pong"
        assert response["id"] == 1

    def test_unknown_method_returns_error(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("nonexistent"))
        assert response["jsonrpc"] == "2.0"
        assert "error" in response
        assert response["error"]["code"] == -32601
        assert "nonexistent" in response["error"]["message"]
        assert response["id"] == 1

    def test_preserves_request_id(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("ping", request_id=42))
        assert response["id"] == 42

    def test_preserves_null_id(self):
        response = handle_request(
            {"jsonrpc": "2.0", "method": "ping", "id": None}
        )
        assert response["id"] is None
        assert response["result"] == "pong"

    def test_missing_id_returns_none(self):
        response = handle_request({"jsonrpc": "2.0", "method": "ping"})
        assert response["id"] is None

    def test_params_passed_as_kwargs(self, jsonrpc_request):
        # ping() takes no params, but we verify the mechanism works
        # by testing with a request that has empty params
        response = handle_request(jsonrpc_request("ping", params={}))
        assert response["result"] == "pong"

    def test_handler_exception_returns_error(self, jsonrpc_request):
        """Handler that raises should return -32000 error."""
        from sample_curation_api.handlers import HANDLERS

        # Temporarily register a failing handler
        def failing_handler():
            raise ValueError("something went wrong")

        HANDLERS["_test_fail"] = failing_handler
        try:
            response = handle_request(jsonrpc_request("_test_fail"))
            assert response["jsonrpc"] == "2.0"
            assert "error" in response
            assert response["error"]["code"] == -32000
            assert "something went wrong" in response["error"]["message"]
        finally:
            del HANDLERS["_test_fail"]

    def test_response_structure_success(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("ping"))
        # Success response must have jsonrpc, result, id — no error
        assert set(response.keys()) == {"jsonrpc", "result", "id"}

    def test_response_structure_error(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("nonexistent"))
        # Error response must have jsonrpc, error, id — no result
        assert set(response.keys()) == {"jsonrpc", "error", "id"}

    def test_error_has_code_and_message(self, jsonrpc_request):
        response = handle_request(jsonrpc_request("nonexistent"))
        error = response["error"]
        assert "code" in error
        assert "message" in error
        assert isinstance(error["code"], int)
        assert isinstance(error["message"], str)
