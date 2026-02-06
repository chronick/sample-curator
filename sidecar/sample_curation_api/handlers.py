"""JSON-RPC method handlers.

DB operations have been migrated to native Rust Tauri commands (db_commands.rs).
This module now only handles ML-related features (future: captioning, semantic search).
"""


def ping() -> str:
    """Health check."""
    return "pong"


# Handler registry — DB handlers removed, ML handlers will be added here
HANDLERS = {
    "ping": ping,
    # Future: "caption_sample": caption_sample,
    # Future: "semantic_search": semantic_search,
}
