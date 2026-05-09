"""Model lifecycle handlers — download, load, unload, remove.

State machine per model:

- not_downloaded         no files in models dir
- downloading            background thread is fetching
- downloaded_not_loaded  files present, not in memory
- loading                load thread running
- loaded                 held in _LOADED dict
- error                  last action failed (with reason)

Files land at ``~/.music-hub-data/models/<safe_id>/`` where ``<safe_id>``
replaces ``/`` with ``__`` so HF repo IDs become filesystem-safe.

Download strategy is per model:

- ``hf`` — pulls from HuggingFace via ``huggingface_hub.snapshot_download``.
  Files materialise under ``<models_dir>/<safe_id>/``.
- ``lib_managed:<lib>`` — the underlying ML library handles the download
  (e.g. demucs writes to ``~/.cache/torch/hub/checkpoints/``). Our manager
  only drops a marker file at ``<models_dir>/<safe_id>/.lib_managed`` so
  ``_is_downloaded`` returns True. ``Remove`` clears the marker (treats
  the model as not-downloaded by *us*); the lib's cache is left intact so
  re-downloads are instant. Documented limitation, not a leak.
"""

import contextlib
import shutil
import threading
import traceback
from pathlib import Path
from typing import Any

_DOWNLOADS: dict[str, dict] = {}
_LOADED: dict[str, Any] = {}
_LOAD_LOCK = threading.Lock()

# Per-model download strategy. Default is "hf" for any model_id not listed.
# Format: "hf" or "lib_managed:<lib>" where <lib> is one of the supported libs
# (currently: ``demucs``).
_DOWNLOAD_STRATEGIES: dict[str, str] = {
    "facebook/htdemucs": "lib_managed:demucs",
}


def _strategy(model_id: str) -> str:
    return _DOWNLOAD_STRATEGIES.get(model_id, "hf")


def _is_lib_managed(model_id: str) -> bool:
    return _strategy(model_id).startswith("lib_managed:")


def _marker_path(model_id: str) -> Path:
    return _model_path(model_id) / ".lib_managed"


def _models_dir() -> Path:
    return Path.home() / ".music-hub-data" / "models"


def _safe_id(model_id: str) -> str:
    return model_id.replace("/", "__").replace("\\", "__")


def _model_path(model_id: str) -> Path:
    return _models_dir() / _safe_id(model_id)


def _is_downloaded(model_id: str) -> bool:
    if _is_lib_managed(model_id):
        return _marker_path(model_id).is_file()
    p = _model_path(model_id)
    if not p.is_dir():
        return False
    return any(f.is_file() and f.stat().st_size > 1_000_000 for f in p.rglob("*"))


def _is_loaded(model_id: str) -> bool:
    return model_id in _LOADED


def _disk_bytes(model_id: str) -> int:
    p = _model_path(model_id)
    if not p.is_dir():
        return 0
    total = 0
    for f in p.rglob("*"):
        if f.is_file():
            with contextlib.suppress(OSError):
                total += f.stat().st_size
    return total


def get_model_state(model_id: str) -> dict:
    dl = _DOWNLOADS.get(model_id)
    if dl and dl["state"] in ("downloading", "loading"):
        return {
            "model_id": model_id,
            "state": dl["state"],
            "error": dl.get("error"),
            "downloaded": _is_downloaded(model_id),
            "loaded": _is_loaded(model_id),
            "disk_bytes": _disk_bytes(model_id),
        }
    if dl and dl["state"] == "error":
        return {
            "model_id": model_id,
            "state": "error",
            "error": dl.get("error"),
            "downloaded": _is_downloaded(model_id),
            "loaded": _is_loaded(model_id),
            "disk_bytes": _disk_bytes(model_id),
        }
    if _is_loaded(model_id):
        return {
            "model_id": model_id,
            "state": "loaded",
            "error": None,
            "downloaded": True,
            "loaded": True,
            "disk_bytes": _disk_bytes(model_id),
        }
    if _is_downloaded(model_id):
        return {
            "model_id": model_id,
            "state": "downloaded_not_loaded",
            "error": None,
            "downloaded": True,
            "loaded": False,
            "disk_bytes": _disk_bytes(model_id),
        }
    return {
        "model_id": model_id,
        "state": "not_downloaded",
        "error": None,
        "downloaded": False,
        "loaded": False,
        "disk_bytes": 0,
    }


def list_model_states(model_ids: list[str]) -> dict[str, dict]:
    return {mid: get_model_state(mid) for mid in model_ids}


def _do_download_hf(model_id: str, cancel: threading.Event) -> None:
    target = _model_path(model_id)
    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        _DOWNLOADS[model_id] = {
            "state": "error",
            "error": f"huggingface_hub not installed: {e}",
            "cancel": cancel,
        }
        return

    target.mkdir(parents=True, exist_ok=True)

    try:
        snapshot_download(
            repo_id=model_id,
            local_dir=str(target),
        )
        if cancel.is_set():
            shutil.rmtree(target, ignore_errors=True)
            _DOWNLOADS.pop(model_id, None)
            return
        _DOWNLOADS.pop(model_id, None)
    except Exception as e:
        traceback.print_exc()
        if cancel.is_set():
            shutil.rmtree(target, ignore_errors=True)
            _DOWNLOADS.pop(model_id, None)
            return
        _DOWNLOADS[model_id] = {
            "state": "error",
            "error": str(e),
            "cancel": cancel,
        }


def _do_download_lib_demucs(model_id: str, cancel: threading.Event) -> None:
    """Trigger a demucs internal download by instantiating the model.

    demucs writes to ``~/.cache/torch/hub/checkpoints/`` and is fast on
    cache hits. We don't keep the result here — load_model will rebuild
    the object when the user enables the feature. After success, drop a
    marker file so ``_is_downloaded`` reports True.
    """
    short = model_id.rsplit("/", 1)[-1]  # "facebook/htdemucs" -> "htdemucs"
    try:
        from demucs.pretrained import get_model
    except ImportError as e:
        _DOWNLOADS[model_id] = {
            "state": "error",
            "error": (
                f"demucs not installed; run `uv sync --extra stems`. ({e})"
            ),
            "cancel": cancel,
        }
        return
    try:
        get_model(short)  # blocks until cached, no-op if already cached
        if cancel.is_set():
            _DOWNLOADS.pop(model_id, None)
            return
        target = _model_path(model_id)
        target.mkdir(parents=True, exist_ok=True)
        _marker_path(model_id).write_text("1\n")
        _DOWNLOADS.pop(model_id, None)
    except Exception as e:
        traceback.print_exc()
        if cancel.is_set():
            _DOWNLOADS.pop(model_id, None)
            return
        _DOWNLOADS[model_id] = {
            "state": "error",
            "error": str(e),
            "cancel": cancel,
        }


def _do_download(model_id: str, cancel: threading.Event) -> None:
    strategy = _strategy(model_id)
    if strategy == "hf":
        _do_download_hf(model_id, cancel)
    elif strategy == "lib_managed:demucs":
        _do_download_lib_demucs(model_id, cancel)
    else:
        _DOWNLOADS[model_id] = {
            "state": "error",
            "error": f"Unknown download strategy: {strategy}",
            "cancel": cancel,
        }


def download_model(model_id: str) -> dict:
    existing = _DOWNLOADS.get(model_id)
    if existing and existing["state"] == "downloading":
        return get_model_state(model_id)
    cancel = threading.Event()
    _DOWNLOADS[model_id] = {
        "state": "downloading",
        "error": None,
        "cancel": cancel,
    }
    thread = threading.Thread(
        target=_do_download, args=(model_id, cancel), daemon=True
    )
    thread.start()
    return get_model_state(model_id)


def cancel_download(model_id: str) -> dict:
    dl = _DOWNLOADS.get(model_id)
    if dl:
        dl["cancel"].set()
        # huggingface_hub doesn't honor cancel mid-flight — best-effort wipe.
    _DOWNLOADS.pop(model_id, None)
    target = _model_path(model_id)
    shutil.rmtree(target, ignore_errors=True)
    return get_model_state(model_id)


def remove_model(model_id: str) -> dict:
    if _is_loaded(model_id):
        unload_model(model_id)
    target = _model_path(model_id)
    # For HF models this wipes the actual weights. For lib_managed models
    # this only removes our marker directory — the underlying lib's cache
    # (e.g. ``~/.cache/torch/hub/checkpoints/``) is untouched. Re-download
    # is therefore instant for lib_managed; intentional, not a leak.
    shutil.rmtree(target, ignore_errors=True)
    _DOWNLOADS.pop(model_id, None)
    return get_model_state(model_id)


_WORKER_DELEGATED_KINDS: dict[str, str] = {
    "laion/clap-htsat-unfused": "embedding",
    "laion/clap-htsat-fused": "embedding",
    "openai/whisper-tiny": "transcription",
    "openai/whisper-base": "transcription",
    "facebook/htdemucs": "stems",
}


def _instantiate_model(model_id: str) -> Any:
    """Resolve a load_model request.

    For every kind that ships its inference through the runtime worker
    subprocess (CLAP, Whisper, Demucs, HF causal-LM), the frozen sidecar
    can't actually instantiate the model — its bundled Python lacks
    transformers / torch / faster-whisper / demucs. Those libs only live
    in the uv-managed runtime venv (vault-347l Phase 2). The worker
    lazy-loads on the first inference call.

    So for delegated kinds we return a marker dict; ``_LOADED[model_id]``
    gets populated and the UI shows ``loaded`` / "ready". When the
    runtime venv is missing, the inference call returns the existing
    soft-error contract — the UI surfaces that on Reload/Retry, not on
    load_model.

    Anything not in the registry (and not a known HF LLM) is a bug.
    """
    if model_id in _WORKER_DELEGATED_KINDS:
        return {
            "delegated_to_worker": True,
            "kind": _WORKER_DELEGATED_KINDS[model_id],
            "model_id": model_id,
        }
    from sample_curation_api.llm import HF_LLM_MODELS, instantiate_hf_llm
    if model_id in HF_LLM_MODELS:
        # Dev path: when transformers + torch are available in *this*
        # interpreter (sidecar venv), prefer in-process load so the dev
        # fallback in ``llm.refine_via_hf`` keeps working when no runtime
        # venv has been provisioned.
        # Frozen sidecar / runtime-venv-only path: ImportError raises here;
        # fall through to the marker so the worker handles inference.
        try:
            return instantiate_hf_llm(model_id)
        except RuntimeError as e:
            if "transformers/torch not installed" not in str(e):
                raise
        return {
            "delegated_to_worker": True,
            "kind": "llm",
            "model_id": model_id,
        }
    raise RuntimeError(f"Unsupported model kind: {model_id}")


def _do_load(model_id: str) -> None:
    """Background-thread load. Updates _LOADED on success, _DOWNLOADS on error.

    The ``loading`` state lives in ``_DOWNLOADS`` until either a success
    flips it to ``loaded`` (drop from _DOWNLOADS, set in _LOADED) or a
    failure to ``error``.
    """
    try:
        obj = _instantiate_model(model_id)
        with _LOAD_LOCK:
            _LOADED[model_id] = obj
            _DOWNLOADS.pop(model_id, None)
    except Exception as e:
        traceback.print_exc()
        with _LOAD_LOCK:
            _DOWNLOADS[model_id] = {
                "state": "error",
                "error": str(e),
                "cancel": threading.Event(),
            }


def load_model(model_id: str) -> dict:
    """Kick off a background load. Returns immediately with the current state.

    Idempotent: if already loaded or already loading, returns current state
    without spawning a duplicate thread. Frontend polls ``get_model_state``
    until the state settles to ``loaded`` or ``error``.
    """
    with _LOAD_LOCK:
        if model_id in _LOADED:
            return get_model_state(model_id)
        existing = _DOWNLOADS.get(model_id)
        if existing and existing["state"] in ("downloading", "loading"):
            return get_model_state(model_id)
        if not _is_downloaded(model_id):
            _DOWNLOADS[model_id] = {
                "state": "error",
                "error": "Model not downloaded",
                "cancel": threading.Event(),
            }
            return get_model_state(model_id)
        _DOWNLOADS[model_id] = {
            "state": "loading",
            "error": None,
            "cancel": threading.Event(),
        }
    threading.Thread(target=_do_load, args=(model_id,), daemon=True).start()
    return get_model_state(model_id)


def unload_model(model_id: str) -> dict:
    with _LOAD_LOCK:
        _LOADED.pop(model_id, None)
        _DOWNLOADS.pop(model_id, None)
    return get_model_state(model_id)
