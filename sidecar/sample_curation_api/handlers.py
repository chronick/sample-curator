"""JSON-RPC method handlers.

DB operations have been migrated to native Rust Tauri commands (db_commands.rs).
This module now only handles ML-related features (future: captioning, semantic search).
"""

import platform
import sys

from sample_curation_api.deps import deps_status
from sample_curation_api.stems import separate_stems
from sample_curation_api.models import (
    cancel_download as ml_cancel_download,
    download_model as ml_download_model,
    list_model_states as ml_list_model_states,
    load_model as ml_load_model,
    remove_model as ml_remove_model,
    unload_model as ml_unload_model,
)
from sample_curation_api.naming import name_recording
from sample_curation_api.ollama_status import (
    OllamaStatus,
    OllamaStatusDict,
    refresh,
    set_model,
)

try:
    from importlib.metadata import version as _pkg_version
except ImportError:  # pragma: no cover — Python <3.8
    _pkg_version = None  # type: ignore[assignment]


def ping() -> str:
    """Health check."""
    return "pong"


def get_sidecar_info() -> dict:
    """Return version info about the running sidecar.

    Surfaced in Settings → About so users can confirm which interpreter
    + sidecar package they're talking to (matters more once we bundle
    the sidecar into the .dmg via PyInstaller — see vault-3bd8).
    """
    pkg_version = "unknown"
    if _pkg_version is not None:
        try:
            pkg_version = _pkg_version("sample-curation-api")
        except Exception:
            pass
    return {
        "package_version": pkg_version,
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "executable": sys.executable,
        "is_frozen": getattr(sys, "frozen", False),
    }


def get_ollama_status() -> OllamaStatusDict:
    """Return the current ollama status snapshot. No side effects."""
    return OllamaStatus.instance().snapshot()


def set_ollama_model(model: str | None = None) -> OllamaStatusDict:
    """Persist a new ollama model selection and re-warmup.

    ``None`` clears the persisted selection and re-runs auto-detect.
    Rejected with a plain RPC error when the env-var override is set.
    """
    return set_model(model)


def refresh_ollama_status() -> OllamaStatusDict:
    """Re-probe the ollama daemon and re-run warmup on the current model.

    Does NOT change the persisted selection.
    """
    return refresh()


# Handler registry — DB handlers removed, ML handlers will be added here
HANDLERS = {
    "ping": ping,
    "get_sidecar_info": get_sidecar_info,
    "name_recording": name_recording,
    "get_ollama_status": get_ollama_status,
    "set_ollama_model": set_ollama_model,
    "refresh_ollama_status": refresh_ollama_status,
    # ML model lifecycle (vault-knuo) — Rust ml_commands.rs proxies these.
    "ml_list_model_states": ml_list_model_states,
    "ml_download_model": ml_download_model,
    "ml_cancel_download": ml_cancel_download,
    "ml_remove_model": ml_remove_model,
    "ml_load_model": ml_load_model,
    "ml_unload_model": ml_unload_model,
    # Runtime ML deps detection (vault-347l).
    "deps_status": deps_status,
    # Stem separation (vault-2nnt). Rust commands.rs proxies this; the
    # sidecar delegates to ml_worker.separate_demucs over the WorkerManager.
    "separate_stems": separate_stems,
    # Future: "caption_sample": caption_sample,
    # Future: "semantic_search": semantic_search,
}
