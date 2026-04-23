"""Ollama status + model-selection singleton.

Resolution priority (first match wins): env > persisted file > ranked list.
``SAMPLE_CURATOR_OLLAMA_MODEL`` hard-overrides UI choice.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Literal, TypedDict

log = logging.getLogger(__name__)

RANKED_MODELS: list[str] = ["gemma4:e2b", "gemma3:1b", "qwen2.5:3b"]

_PERSIST_DIR = Path.home() / ".music-hub-data"
_PERSIST_PATH = _PERSIST_DIR / "sample-curator-llm.json"
_ENV_VAR = "SAMPLE_CURATOR_OLLAMA_MODEL"

OllamaState = Literal["not_loaded", "loading", "loaded", "errored"]


class OllamaStatusDict(TypedDict):
    state: OllamaState
    model: str | None
    available_models: list[str]
    error: str | None


class OllamaStatus:
    _instance: OllamaStatus | None = None
    _cls_lock = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.state: OllamaState = "not_loaded"
        self.model: str | None = None
        self.available_models: list[str] = []
        self.error: str | None = None
        self._unreachable_logged = False

    @classmethod
    def instance(cls) -> OllamaStatus:
        with cls._cls_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def _reset_for_tests(cls) -> None:
        with cls._cls_lock:
            cls._instance = None

    def snapshot(self) -> OllamaStatusDict:
        with self._lock:
            return {
                "state": self.state,
                "model": self.model,
                "available_models": list(self.available_models),
                "error": self.error,
            }

    def current_model(self) -> str | None:
        with self._lock:
            return self.model


def _load_persisted() -> dict:
    try:
        with _PERSIST_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_persisted(data: dict) -> None:
    _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _PERSIST_PATH.with_suffix(_PERSIST_PATH.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, _PERSIST_PATH)


def _list_available_models() -> tuple[list[str] | None, str | None]:
    """Return (models, error). models is None iff daemon unreachable."""
    try:
        import ollama  # type: ignore

        resp = ollama.list()
    except Exception as e:
        return None, str(e)
    raw = resp.get("models", []) if isinstance(resp, dict) else getattr(resp, "models", [])
    out: list[str] = []
    for m in raw:
        name = m.get("name") or m.get("model") if isinstance(m, dict) else getattr(m, "name", None)
        if isinstance(name, str) and name:
            out.append(name)
    return out, None


def _log_unreachable_once() -> None:
    status = OllamaStatus.instance()
    with status._lock:
        already = status._unreachable_logged
        status._unreachable_logged = True
    if already:
        return
    print(
        "[ollama] daemon unreachable at localhost:11434 "
        "— see sidecar/README.md § Enable LLM Vocal Naming for install",
        file=sys.stderr,
        flush=True,
    )


def resolve_model() -> tuple[str | None, str]:
    """Return ``(model, reason)``. Env var is read fresh on every call."""
    env_model = os.environ.get(_ENV_VAR)
    if env_model:
        return env_model, "env"
    available, _err = _list_available_models()
    status = OllamaStatus.instance()
    if available is None:
        with status._lock:
            status.available_models = []
        _log_unreachable_once()
        return None, "daemon unreachable"
    with status._lock:
        status.available_models = list(available)
    persisted = _load_persisted().get("selected_model")
    if isinstance(persisted, str) and persisted:
        return persisted, "persisted"
    for candidate in RANKED_MODELS:
        if candidate in available:
            return candidate, "ranked"
    return None, "no ranked model available"


def warmup_model(model: str) -> None:
    """Warm up ``model`` via a 1-token chat. Mutates status. Never raises."""
    status = OllamaStatus.instance()
    with status._lock:
        status.state = "loading"
        status.model = model
        status.error = None
    try:
        import ollama  # type: ignore

        ollama.chat(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            options={"num_predict": 1},
            stream=False,
        )
    except Exception as e:
        with status._lock:
            status.state = "errored"
            status.error = str(e)
        return
    with status._lock:
        status.state = "loaded"
        status.error = None


def resolve_and_warmup() -> OllamaStatusDict:
    status = OllamaStatus.instance()
    model, reason = resolve_model()
    if model is None:
        with status._lock:
            status.state = "not_loaded"
            status.model = None
            status.error = reason
        return status.snapshot()
    warmup_model(model)
    return status.snapshot()


def set_model(model: str | None) -> OllamaStatusDict:
    """Persist a new selection + re-warmup. Raises ``ValueError`` if env var set."""
    if os.environ.get(_ENV_VAR):
        raise ValueError("env var SAMPLE_CURATOR_OLLAMA_MODEL overrides UI selection")
    _save_persisted({"selected_model": model})
    return resolve_and_warmup()


def refresh() -> OllamaStatusDict:
    """Re-probe + re-warmup without changing persisted selection."""
    return resolve_and_warmup()
