"""JSON-RPC method handlers.

DB operations have been migrated to native Rust Tauri commands (db_commands.rs).
This module now only handles ML-related features (future: captioning, semantic search).
"""

from sample_curation_api.naming import name_recording
from sample_curation_api.ollama_status import (
    OllamaStatus,
    OllamaStatusDict,
    refresh,
    set_model,
)


def ping() -> str:
    """Health check."""
    return "pong"


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
    "name_recording": name_recording,
    "get_ollama_status": get_ollama_status,
    "set_ollama_model": set_ollama_model,
    "refresh_ollama_status": refresh_ollama_status,
    # Future: "caption_sample": caption_sample,
    # Future: "semantic_search": semantic_search,
}
