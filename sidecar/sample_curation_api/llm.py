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

# Same template as the legacy ollama path — works fine for small instruct
# models (Qwen 2.5 0.5B, Phi-3-mini).
LLM_PROMPT_TEMPLATE = """You are naming a short vocal audio sample for a music producer's sample library.

Transcript: "{transcript}"

Produce a memorable 2-4 word filename stem. Rules:
- Lowercase only, words joined by hyphens (e.g. 'eternal-wave-chant')
- Use evocative content words (nouns, strong verbs); skip filler
- Max 40 characters total
- Return ONLY the stem — no quotes, no explanation, no trailing punctuation

Stem:"""

ML_CONFIG_PATH = Path.home() / ".music-hub-data" / "ml-features-config.json"


def get_active_backend() -> str | None:
    """Return the backend currently selected for the LLM feature, or
    ``None`` if the feature is disabled or no config is on disk.
    Used by ``naming.py`` to decide whether to surface
    ``transcript_for_external_refine`` (foundation backend = Rust handles
    refinement post-hoc via the Swift bridge)."""
    backend, _model_id, enabled = _load_active_llm_config()
    if not enabled:
        return None
    return backend


def _load_active_llm_config() -> tuple[str | None, str | None, bool]:
    """Read the active LLM feature config from disk.

    Returns ``(backend, model_id, enabled)``. Any read/parse error returns
    ``(None, None, False)``.
    """
    try:
        with ML_CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None, None, False
    feat = data.get("features", {}).get("llm_naming_refinement")
    if not isinstance(feat, dict):
        return None, None, False
    return (
        feat.get("backend") or None,
        feat.get("model_id") or None,
        bool(feat.get("enabled", False)),
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

    try:
        import torch  # type: ignore
    except ImportError:
        return None

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

    Raises ``RuntimeError`` if dependencies are missing or the snapshot is
    incomplete — caller (``models._do_load``) records the error in
    ``_DOWNLOADS`` so the UI surfaces it.
    """
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch
    except ImportError as e:
        raise RuntimeError(
            f"transformers/torch not installed; run `uv sync --extra llm-hf`. ({e})"
        ) from e

    # Local circular avoidance.
    from sample_curation_api.models import _model_path

    ckpt_dir = _model_path(model_id)
    if not (ckpt_dir / "config.json").is_file():
        raise RuntimeError(f"No config.json found in {ckpt_dir}")

    tok = AutoTokenizer.from_pretrained(str(ckpt_dir))
    # ``dtype`` (transformers 5.x) replaces the deprecated ``torch_dtype``.
    # No ``device_map`` — CPU is the default, and ``device_map="cpu"`` would
    # require ``accelerate`` (which isn't always installed even with the
    # ``[llm-hf]`` extra applied to the running venv).
    model = AutoModelForCausalLM.from_pretrained(
        str(ckpt_dir),
        dtype=torch.float32,
    )
    model.eval()
    return {"tokenizer": tok, "model": model}


# ---------------------------------------------------------------------------
# Top-level dispatcher
# ---------------------------------------------------------------------------


def refine_transcript(transcript: str) -> str | None:
    """Dispatch to the active backend. Returns ``None`` when:

    - LLM feature is disabled
    - Active backend is ``foundation`` (handled by Rust post-hoc)
    - Backend-specific refinement fails (model not loaded, daemon down, etc.)
    """
    if not transcript or not transcript.strip():
        return None

    backend, model_id, enabled = _load_active_llm_config()
    if not enabled:
        return None
    if not backend:
        # Pre-Slice-1 config or malformed — fall back to legacy ollama
        # auto-detect for back-compat with existing installs.
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
