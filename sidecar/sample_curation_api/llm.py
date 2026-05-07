"""Multi-backend LLM refinement for filename stems (vault-3ume).

Three backends share a single ``refine_transcript(transcript)`` entry point:

- ``ollama`` — local daemon, via ``ollama.chat``. Existing path.
- ``hf`` — in-process via ``transformers.AutoModelForCausalLM``. New.
  Reads from ``models._LOADED`` (populated by ``ml_load_model``).
- ``foundation`` — Apple Foundation Models. Not implemented in this
  module; ``refine_transcript`` returns ``None`` and signals to the
  caller (Rust recorder finalize) to invoke the Swift bridge directly.

Active backend + model_id come from
``~/.music-hub-data/ml-features-config.json`` for the
``llm_naming_refinement`` feature. Falls back to legacy ollama
auto-detect when the config is absent or malformed.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Pre-import the HF LLM symbols at module-load time so the lazy module
# loader runs in the main thread. ``models._do_load`` spawns a daemon
# thread that calls ``instantiate_hf_llm`` — without this preload,
# transformers 5.x's ``_LazyModule.__getattr__`` can race in the
# background thread and surface as
# ``ImportError: cannot import name 'AutoModelForCausalLM' from
# 'transformers'`` even though the symbols exist in the venv.
#
# Wrapped in try/except so the sidecar still boots when ``[llm-hf]`` is
# not installed (the user only wants ollama / foundation backends).
_HF_PRELOADED: bool = False
try:
    from transformers import AutoModelForCausalLM as _PRELOAD_AUTO_LM  # noqa: F401
    from transformers import AutoTokenizer as _PRELOAD_AUTO_TOK  # noqa: F401
    import torch as _PRELOAD_TORCH  # noqa: F401

    _HF_PRELOADED = True
except Exception as _hf_preload_err:  # noqa: BLE001 — broad catch is intentional
    log.info(
        "HF LLM backend unavailable (preload failed: %s) — install with `uv sync --extra llm-hf`",
        _hf_preload_err,
    )

# Single source of truth for the LLM prompt template, shared with Rust's
# Foundation Models bridge (which reads the same file via ``include_str!``).
# Same template across all three backends (ollama / hf / foundation) so they
# produce comparable outputs — works fine for small instruct models
# (Qwen 2.5 0.5B, Phi-3-mini, Apple Foundation Models).
LLM_PROMPT_TEMPLATE = (Path(__file__).parent / "llm_prompt.txt").read_text(encoding="utf-8")

ML_CONFIG_PATH = Path.home() / ".music-hub-data" / "ml-features-config.json"


def get_active_backend() -> str | None:
    """Return the backend currently selected for the LLM feature, or
    ``None`` if the feature is disabled or no config is on disk.
    Used by ``naming.py`` to decide whether to surface
    ``transcript_for_external_refine`` (foundation backend = Rust handles
    refinement post-hoc via the Swift bridge)."""
    backend, _model_id, enabled, _exists = _load_active_llm_config()
    if not enabled:
        return None
    return backend


def _load_active_llm_config() -> tuple[str | None, str | None, bool, bool]:
    """Read the active LLM feature config from disk.

    Returns ``(backend, model_id, enabled, config_exists)``. ``config_exists``
    distinguishes "no config file at all" (legacy install) from "config
    file says feature is off" — only the latter should suppress legacy
    ollama auto-detect.
    """
    try:
        with ML_CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None, None, False, False
    except json.JSONDecodeError:
        return None, None, False, True
    feat = data.get("features", {}).get("llm_naming_refinement")
    if not isinstance(feat, dict):
        return None, None, False, True
    return (
        feat.get("backend") or None,
        feat.get("model_id") or None,
        bool(feat.get("enabled", False)),
        True,
    )


def _sanitize_stem(raw: str) -> str:
    """Reduce LLM output to filename-safe chars."""
    stem = raw.strip().lower()
    stem = stem.split("\n", 1)[0].strip()
    for ch in ('"', "'", "`", "*", "_"):
        stem = stem.replace(ch, "")
    stem = stem.replace(" ", "-")
    stem = "".join(c for c in stem if c.isascii() and (c.isalnum() or c == "-"))
    while "--" in stem:
        stem = stem.replace("--", "-")
    return stem.strip("-")


# ---------------------------------------------------------------------------
# Ollama backend
# ---------------------------------------------------------------------------

OLLAMA_TIMEOUT_S = 8.0


def _refine_with_ollama(transcript: str, model_id: str) -> str | None:
    if not model_id:
        return None
    try:
        import ollama  # type: ignore
    except ImportError:
        return None
    try:
        prompt = LLM_PROMPT_TEMPLATE.format(transcript=transcript.strip())
        response = ollama.chat(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.4, "num_predict": 24},
            stream=False,
        )
        raw = response.get("message", {}).get("content", "")
        sanitized = _sanitize_stem(raw)
        if not sanitized or len(sanitized) < 3 or len(sanitized) > 60:
            return None
        return sanitized
    except Exception as e:
        log.warning("Ollama refinement (%s) failed: %s", model_id, e)
        return None


# ---------------------------------------------------------------------------
# HF transformers backend
# ---------------------------------------------------------------------------

# Model_ids the HF backend knows how to load. Used by ``models._instantiate_model``
# to pick the AutoModelForCausalLM path. Must match the registry in Rust
# (``ml_commands.rs::registered_models``).
HF_LLM_MODELS: frozenset[str] = frozenset({
    "Qwen/Qwen2.5-0.5B-Instruct",
})


def _refine_with_hf(transcript: str, model_id: str) -> str | None:
    """Refine via a loaded HuggingFace causal-LM. Reads from ``models._LOADED``;
    returns ``None`` if the model isn't loaded (the user should toggle the
    feature on or click Load in Settings first).
    """
    # Local import to avoid circular: models -> llm via _instantiate_model.
    from sample_curation_api import models as ml_models

    loaded = ml_models._LOADED.get(model_id)
    if loaded is None:
        log.info("HF LLM %s not loaded; refinement skipped", model_id)
        return None
    if not _HF_PRELOADED:
        return None
    torch = _PRELOAD_TORCH

    try:
        tok = loaded["tokenizer"]
        model = loaded["model"]
    except (KeyError, TypeError):
        log.warning("HF LLM %s loaded but missing tokenizer/model keys", model_id)
        return None

    try:
        prompt = LLM_PROMPT_TEMPLATE.format(transcript=transcript.strip())
        # Prefer the chat template when the model defines one; otherwise fall
        # back to raw prompt encoding. Qwen / Phi-3 / Gemma all ship templates.
        # In transformers 5.x both paths return a ``BatchEncoding`` (dict-like
        # with ``input_ids``); older versions of ``apply_chat_template`` returned
        # a bare tensor. We tolerate both via ``getattr``.
        if getattr(tok, "chat_template", None):
            encoded = tok.apply_chat_template(
                [{"role": "user", "content": prompt}],
                return_tensors="pt",
                add_generation_prompt=True,
            )
        else:
            encoded = tok(prompt, return_tensors="pt")
        input_ids = getattr(encoded, "input_ids", encoded)

        with torch.no_grad():
            output = model.generate(
                input_ids,
                max_new_tokens=24,
                do_sample=False,
                pad_token_id=getattr(tok, "pad_token_id", None) or tok.eos_token_id,
            )
        # Decode only the newly-generated tokens (after the prompt).
        new_tokens = output[0][input_ids.shape[-1]:]
        raw = tok.decode(new_tokens, skip_special_tokens=True)
        sanitized = _sanitize_stem(raw)
        if not sanitized or len(sanitized) < 3 or len(sanitized) > 60:
            return None
        return sanitized
    except Exception as e:
        log.warning("HF LLM refinement (%s) failed: %s", model_id, e)
        return None


def instantiate_hf_llm(model_id: str) -> dict[str, Any]:
    """Load a HuggingFace causal-LM from a local snapshot directory.

    Returns ``{"tokenizer": ..., "model": ...}``. Called by
    ``models._instantiate_model`` when ``model_id in HF_LLM_MODELS``.

    Symbols are pre-imported at module load (see top of file) so this
    can run in a daemon thread without tripping transformers 5.x lazy
    loader races. Raises ``RuntimeError`` if preload failed (extras not
    installed) or the snapshot is incomplete — caller
    (``models._do_load``) records the error in ``_DOWNLOADS`` so the
    UI surfaces it.
    """
    if not _HF_PRELOADED:
        raise RuntimeError(
            "transformers/torch not installed; run `uv sync --extra llm-hf`."
        )

    # Local circular avoidance.
    from sample_curation_api.models import _model_path

    ckpt_dir = _model_path(model_id)
    if not (ckpt_dir / "config.json").is_file():
        raise RuntimeError(f"No config.json found in {ckpt_dir}")

    tok = _PRELOAD_AUTO_TOK.from_pretrained(str(ckpt_dir))
    # ``dtype`` (transformers 5.x) replaces the deprecated ``torch_dtype``.
    # No ``device_map`` — CPU is the default, and ``device_map="cpu"`` would
    # require ``accelerate`` (which isn't always installed even with the
    # ``[llm-hf]`` extra applied to the running venv).
    model = _PRELOAD_AUTO_LM.from_pretrained(
        str(ckpt_dir),
        dtype=_PRELOAD_TORCH.float32,
    )
    model.eval()
    return {"tokenizer": tok, "model": model}


# ---------------------------------------------------------------------------
# Top-level dispatcher
# ---------------------------------------------------------------------------


def refine_transcript(transcript: str) -> str | None:
    """Dispatch to the active backend. Returns ``None`` when:

    - LLM feature is explicitly disabled in the config
    - Active backend is ``foundation`` (handled by Rust post-hoc)
    - Backend-specific refinement fails (model not loaded, daemon down, etc.)

    Back-compat: when no config file exists at all (legacy install),
    fall back to the OllamaStatus auto-detect path so existing setups
    keep working without touching Settings.
    """
    if not transcript or not transcript.strip():
        return None

    backend, model_id, enabled, config_exists = _load_active_llm_config()

    if not config_exists:
        # Legacy install — no Settings dialog has ever written the config
        # file. Use the pre-Slice-1 ollama auto-detect path.
        return _refine_with_ollama_legacy(transcript)

    if not enabled:
        return None
    if not backend:
        # Config exists but backend wasn't migrated — fall back to legacy
        # ollama auto-detect for safety.
        return _refine_with_ollama_legacy(transcript)

    if backend == "ollama":
        return _refine_with_ollama(transcript, model_id or "")
    if backend == "hf":
        return _refine_with_hf(transcript, model_id or "")
    if backend == "foundation":
        # Rust handles this post-hoc — see Slice 3 / recorder finalize.
        return None
    log.warning("Unknown LLM backend: %s", backend)
    return None


def _refine_with_ollama_legacy(transcript: str) -> str | None:
    """Back-compat: when ml-features-config.json is missing or backend-less,
    use the legacy OllamaStatus auto-detect path."""
    try:
        from sample_curation_api.ollama_status import OllamaStatus
        model_id = OllamaStatus.instance().current_model()
        if not model_id:
            return None
        return _refine_with_ollama(transcript, model_id)
    except Exception as e:
        log.warning("Legacy ollama refinement failed: %s", e)
        return None
