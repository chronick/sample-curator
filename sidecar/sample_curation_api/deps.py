"""Runtime ML dependency detection (vault-347l).

Each ML feature in Sample Curator depends on one or more heavy Python
extras (transformers, torch, faster-whisper, demucs, ollama). The
bundled production sidecar ships without them — this module reports
which extras are present so the UI can surface install state and grey
out toggles whose deps are missing.

Phase 1: read-only detection. Phase 2 (separate task) wires actual
install via a uv-managed runtime venv.
"""

from __future__ import annotations

import importlib.util
from typing import TypedDict


class ExtraStatus(TypedDict):
    installed: bool
    missing: list[str]


class DepsStatus(TypedDict):
    extras: dict[str, ExtraStatus]


# Map extra-name → list of importable module names that must all resolve
# for the extra to count as "installed". Module names (not pyproject
# package names) so we can use ``importlib.util.find_spec`` directly.
EXTRA_MODULES: dict[str, list[str]] = {
    "embedding": ["transformers", "torch", "laion_clap", "torchvision"],
    "transcription": ["faster_whisper"],
    "stems": ["demucs", "torch"],
    # ``accelerate`` is intentionally NOT required: ``llm.py`` deliberately
    # avoids ``device_map="cpu"`` so the model loads on plain torch on CPU.
    # If we add GPU/MPS dispatch later we'll re-add accelerate here.
    "llm_hf": ["transformers", "torch"],
    "llm_ollama": ["ollama"],
}


def _module_present(name: str) -> bool:
    """Return True if ``name`` can be imported without actually importing it."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        # ValueError: spec resolution can fail mid-walk on broken installs.
        return False


def deps_status() -> DepsStatus:
    """Report which ML extras are installed and what's missing per extra.

    Frontend renders the result as a Dependencies card; greyed feature
    toggles read ``extras[<name>].installed`` to decide enablement.
    """
    extras: dict[str, ExtraStatus] = {}
    for extra_name, modules in EXTRA_MODULES.items():
        missing = [m for m in modules if not _module_present(m)]
        extras[extra_name] = {
            "installed": not missing,
            "missing": missing,
        }
    return {"extras": extras}
