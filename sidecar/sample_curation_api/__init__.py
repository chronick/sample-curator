"""Sample Curation API - JSON-RPC server for Tauri GUI.

ML-only sidecar. DB operations are handled by native Rust Tauri commands.
"""

import json
import sys
import traceback
from pathlib import Path
from typing import Any

# Ensure vendored packages (sample_analysis, sample_library) are importable
_vendor_dir = Path(__file__).resolve().parent.parent / "vendor"
if str(_vendor_dir) not in sys.path:
    sys.path.insert(0, str(_vendor_dir))

try:
    from sample_curation_api.handlers import HANDLERS
except ImportError as e:
    # Graceful startup if optional deps are missing
    print(f"Warning: Some imports failed: {e}", file=sys.stderr)
    HANDLERS = {
        "ping": lambda: "pong",
    }


def handle_request(request: dict) -> dict:
    """Handle a JSON-RPC request.

    Args:
        request: JSON-RPC request dict.

    Returns:
        JSON-RPC response dict.
    """
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params", {})

    if method not in HANDLERS:
        return {
            "jsonrpc": "2.0",
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
            "id": request_id,
        }

    try:
        result = HANDLERS[method](**params)
        return {
            "jsonrpc": "2.0",
            "result": result,
            "id": request_id,
        }
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {
            "jsonrpc": "2.0",
            "error": {
                "code": -32000,
                "message": str(e),
            },
            "id": request_id,
        }


def _startup_warmup() -> None:
    """Resolve + warm up the ollama model in the background. Never raises."""
    try:
        from sample_curation_api.ollama_status import resolve_and_warmup

        resolve_and_warmup()
    except Exception as e:
        print(f"[ollama] startup warmup failed: {e}", file=sys.stderr, flush=True)


def main():
    """Main entry point - JSON-RPC server over stdio."""
    import threading

    threading.Thread(target=_startup_warmup, daemon=True).start()

    # Line-buffered stdio
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            response = handle_request(request)
            print(json.dumps(response), flush=True)
        except json.JSONDecodeError as e:
            error_response = {
                "jsonrpc": "2.0",
                "error": {
                    "code": -32700,
                    "message": f"Parse error: {e}",
                },
                "id": None,
            }
            print(json.dumps(error_response), flush=True)


if __name__ == "__main__":
    main()
