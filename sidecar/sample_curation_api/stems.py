"""Stem separation glue (vault-2nnt).

Sidecar-side handler for the ``separate_stems`` JSON-RPC method. The
heavy lifting (loading the demucs model, running inference, writing
stem WAVs) lives in ``ml_worker.separate_demucs`` so it runs inside the
runtime venv where torch + demucs + torchaudio are installed. This
module is just the glue:

- Validates the input path exists.
- Resolves a sensible default ``output_dir`` next to the source clip
  when the caller doesn't pass one.
- Invokes the worker via ``WorkerManager``.
- Returns ``{"stems": {role: path, ...}}`` on success or
  ``{"stems": None, "error": ...}`` on failure (matches the worker's
  contract and the rest of the inference handlers).

The default model is ``facebook/htdemucs`` — the 4-source variant
(drums / bass / other / vocals). If a different model is wanted later,
the Tauri command can pass ``model_id``.
"""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_MODEL = "facebook/htdemucs"


def separate_stems(
    audio_path: str,
    output_dir: str | None = None,
    model_id: str = DEFAULT_MODEL,
) -> dict:
    """Run demucs separation on ``audio_path``, write stems under ``output_dir``.

    Returns ``{"stems": {role: path}}`` or ``{"stems": None, "error": ...}``.
    """
    src = Path(audio_path)
    if not src.is_file():
        return {"stems": None, "error": f"audio file not found: {audio_path}"}

    if output_dir is None:
        # Default: <source_dir>/stems/<source_stem>/
        output_dir = str(src.parent / "stems" / src.stem)

    try:
        from sample_curation_api.worker_manager import (
            available,
            get_worker,
            WorkerError,
        )
    except Exception as e:  # pragma: no cover — import failure path
        return {"stems": None, "error": f"worker_manager unavailable: {e}"}

    if not available():
        return {
            "stems": None,
            "error": (
                "Stem separation requires the runtime venv. "
                "Install via Settings → Analysis & ML → Stems."
            ),
        }

    try:
        wm = get_worker()
        result = wm.call(
            "separate_demucs",
            {
                "model_id": model_id,
                "audio_path": str(src),
                "output_dir": output_dir,
            },
        )
        return result
    except WorkerError as e:
        return {"stems": None, "error": f"worker call failed: {e}"}
    except Exception as e:
        log.exception("separate_stems failed")
        return {"stems": None, "error": f"separate_stems failed: {e}"}
