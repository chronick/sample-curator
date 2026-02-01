"""Sample Curation API - JSON-RPC server for Tauri GUI."""

import json
import sys
import traceback
from typing import Any

from sample_curation_api.handlers import HANDLERS


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


def main():
    """Main entry point - JSON-RPC server over stdio."""
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
