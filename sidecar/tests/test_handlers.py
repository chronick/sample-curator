"""Tests for sample_curation_api.handlers."""

from sample_curation_api.handlers import HANDLERS, ping


class TestPing:
    def test_returns_pong(self):
        assert ping() == "pong"

    def test_handler_registered(self):
        assert "ping" in HANDLERS
        assert HANDLERS["ping"]() == "pong"


class TestHandlerRegistry:
    def test_handlers_is_dict(self):
        assert isinstance(HANDLERS, dict)

    def test_all_handlers_are_callable(self):
        for name, handler in HANDLERS.items():
            assert callable(handler), f"Handler '{name}' is not callable"

    def test_ping_is_registered(self):
        assert "ping" in HANDLERS
