"""Tests for sample_curation_api.ollama_status."""

from __future__ import annotations

import importlib
import json
import sys

import pytest

from sample_curation_api import ollama_status
from sample_curation_api.ollama_status import (
    RANKED_MODELS,
    OllamaStatus,
    refresh,
    resolve_model,
    set_model,
    warmup_model,
)

_ENV_VAR = "SAMPLE_CURATOR_OLLAMA_MODEL"


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    pdir = tmp_path / ".music-hub-data"
    ppath = pdir / "sample-curator-llm.json"
    monkeypatch.setattr(ollama_status, "_PERSIST_DIR", pdir)
    monkeypatch.setattr(ollama_status, "_PERSIST_PATH", ppath)
    monkeypatch.delenv(_ENV_VAR, raising=False)
    return ppath


def _fake_ollama(monkeypatch, *, models=None, chat=None, raise_list=None):
    fake = type("FakeOllama", (), {})()
    if raise_list is not None:
        fake.list = lambda: (_ for _ in ()).throw(raise_list)
    else:
        fake.list = lambda: {"models": [{"name": m} for m in (models or [])]}
    fake.chat = chat or (lambda **kw: {"message": {"content": "ok"}})
    monkeypatch.setitem(sys.modules, "ollama", fake)


class TestResolveModel:
    def test_env_wins(self, fake_home, monkeypatch):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text(json.dumps({"selected_model": "persisted:1b"}))
        _fake_ollama(monkeypatch, models=RANKED_MODELS)
        monkeypatch.setenv(_ENV_VAR, "env-override:5b")
        assert resolve_model() == ("env-override:5b", "env")

    def test_persisted_wins_over_ranked(self, fake_home, monkeypatch):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text(json.dumps({"selected_model": "persisted:1b"}))
        _fake_ollama(monkeypatch, models=[*RANKED_MODELS, "persisted:1b"])
        assert resolve_model() == ("persisted:1b", "persisted")

    def test_ranked_priority(self, fake_home, monkeypatch):
        _fake_ollama(monkeypatch, models=["qwen2.5:3b", "gemma3:1b"])
        # gemma3:1b outranks qwen2.5:3b
        assert resolve_model() == ("gemma3:1b", "ranked")

    def test_no_ranked_available(self, fake_home, monkeypatch):
        _fake_ollama(monkeypatch, models=["llama3:8b"])
        assert resolve_model() == (None, "no ranked model available")

    def test_daemon_unreachable_logs_once(self, fake_home, monkeypatch, capsys):
        _fake_ollama(monkeypatch, raise_list=ConnectionError("refused"))
        assert resolve_model() == (None, "daemon unreachable")
        resolve_model()
        resolve_model()
        err = capsys.readouterr().err
        assert err.count("[ollama] daemon unreachable") == 1

    def test_env_read_fresh(self, fake_home, monkeypatch):
        _fake_ollama(monkeypatch, models=RANKED_MODELS)
        assert resolve_model()[1] == "ranked"
        monkeypatch.setenv(_ENV_VAR, "late:1b")
        assert resolve_model() == ("late:1b", "env")


class TestWarmup:
    def test_loaded_on_success(self, monkeypatch):
        _fake_ollama(monkeypatch)
        warmup_model("any:model")
        snap = OllamaStatus.instance().snapshot()
        assert snap["state"] == "loaded"
        assert snap["model"] == "any:model"
        assert snap["error"] is None

    def test_errored_on_exception(self, monkeypatch):
        _fake_ollama(monkeypatch, chat=lambda **kw: (_ for _ in ()).throw(RuntimeError("boom")))
        warmup_model("missing:model")
        snap = OllamaStatus.instance().snapshot()
        assert snap["state"] == "errored"
        assert "boom" in snap["error"]
        # Must not raise
        warmup_model("another")


class TestSetModel:
    def test_persists_and_warms(self, fake_home, monkeypatch):
        _fake_ollama(monkeypatch, models=["picked:1b"])
        snap = set_model("picked:1b")
        assert snap == {
            "state": "loaded",
            "model": "picked:1b",
            "available_models": ["picked:1b"],
            "error": None,
        }
        assert json.loads(fake_home.read_text()) == {"selected_model": "picked:1b"}

    def test_none_clears_and_reresolves(self, fake_home, monkeypatch):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text(json.dumps({"selected_model": "old:1b"}))
        _fake_ollama(monkeypatch, models=RANKED_MODELS)
        snap = set_model(None)
        assert json.loads(fake_home.read_text()) == {"selected_model": None}
        assert snap["model"] == RANKED_MODELS[0]

    def test_rejected_when_env_set(self, fake_home, monkeypatch):
        monkeypatch.setenv(_ENV_VAR, "locked:1b")
        with pytest.raises(ValueError, match="env var SAMPLE_CURATOR_OLLAMA_MODEL"):
            set_model("other:1b")


class TestRefresh:
    def test_refresh_keeps_persisted(self, fake_home, monkeypatch):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text(json.dumps({"selected_model": "picked:1b"}))
        _fake_ollama(monkeypatch, models=["picked:1b"])
        refresh()
        assert json.loads(fake_home.read_text()) == {"selected_model": "picked:1b"}


class TestPersistence:
    def test_malformed_file_read_returns_empty(self, fake_home):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text("not json!!!")
        assert ollama_status._load_persisted() == {}

    def test_replace_failure_leaves_file_intact(self, fake_home, monkeypatch):
        fake_home.parent.mkdir(parents=True, exist_ok=True)
        fake_home.write_text(json.dumps({"selected_model": "stable:1b"}))
        import os as _os

        monkeypatch.setattr(
            _os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full"))
        )
        with pytest.raises(OSError):
            ollama_status._save_persisted({"selected_model": "new:1b"})
        assert json.loads(fake_home.read_text()) == {"selected_model": "stable:1b"}


class TestSnapshotAndHandlers:
    def test_snapshot_keys_exact(self):
        assert set(OllamaStatus.instance().snapshot().keys()) == {
            "state",
            "model",
            "available_models",
            "error",
        }

    def test_handlers_registered(self):
        from sample_curation_api.handlers import HANDLERS

        for name in ("get_ollama_status", "set_ollama_model", "refresh_ollama_status"):
            assert name in HANDLERS


class TestImportSideEffects:
    def test_package_import_does_not_touch_ollama(self, monkeypatch):
        fake = type("Exploding", (), {})()
        fake.chat = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("chat touched"))
        fake.list = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("list touched"))
        monkeypatch.setitem(sys.modules, "ollama", fake)
        for name in list(sys.modules):
            if name == "sample_curation_api" or name.startswith("sample_curation_api."):
                sys.modules.pop(name, None)
        importlib.import_module("sample_curation_api")
        importlib.import_module("sample_curation_api.ollama_status")
        importlib.import_module("sample_curation_api.handlers")
