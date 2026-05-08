"""ML worker subprocess (vault-347l Phase 2).

Runs from the user's *runtime venv* at
``~/.music-hub-data/python/runtime/.venv/`` rather than the frozen
sidecar's interpreter. The frozen sidecar can't pip-install heavy ML
libraries (PyInstaller bakes site-packages at build time), so we
delegate model loading + inference to this worker, which lives in a
venv that *can* be uv-synced at runtime.

Protocol: line-delimited JSON-RPC 2.0 over stdin/stdout. The frozen
sidecar's ``WorkerManager`` (slice 4) starts/owns one of these per
session and forwards CLAP / Whisper / demucs / LLM-HF calls.

Self-contained — does NOT import ``sample_curation_api``. The runtime
venv only ships the heavy ML libs (transformers, torch, faster-whisper,
demucs); the sidecar package is irrelevant here. Helper code is small
enough that duplication beats the cost of installing the sidecar
package into the runtime venv.

Slice 3 (this commit): JSON-RPC skeleton + lifecycle methods (ping,
system_info, load_model, unload_model, shutdown). Per-kind inference
handlers (embed_clap, transcribe_whisper, separate_demucs, refine_llm_hf)
are stubs that return ``not_implemented`` — slice 4 fleshes them out
alongside the sidecar refactor that actually delegates to the worker.
"""

from __future__ import annotations

import json
import platform
import sys
import threading
import traceback
from typing import Any, Callable

# ---------- Worker state ----------

# Single-model-at-a-time for v1. Keeps memory bounded and the protocol
# simple — sidecar tells the worker which model to hold; switching is
# unload + load. v2 can keep multiple loaded across kinds (LLM + CLAP)
# if profiling shows the unload/reload cost matters.
_LOADED: dict[str, Any] = {}
_LOADED_LOCK = threading.Lock()


# ---------- Logging ----------

def _log(msg: str) -> None:
    """Stderr is reserved for diagnostic logs; stdout is the JSON-RPC
    channel. The sidecar's WorkerManager mirrors stderr into the main
    sidecar log."""
    print(f"[ml_worker] {msg}", file=sys.stderr, flush=True)


# ---------- RPC handlers ----------

def ping() -> str:
    return "pong"


def system_info() -> dict:
    """Return interpreter + lib version info. Used by WorkerManager
    health checks and for debug surfacing in Settings → About."""
    info: dict[str, Any] = {
        "python_version": platform.python_version(),
        "python_executable": sys.executable,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "available_libs": {},
    }
    # Probe for each heavy lib without forcing import — find_spec is
    # cheap and side-effect-free.
    import importlib.util
    for name in ("torch", "transformers", "laion_clap", "faster_whisper", "demucs"):
        info["available_libs"][name] = importlib.util.find_spec(name) is not None
    return info


def load_model(model_id: str, kind: str, backend: str = "hf") -> dict:
    """Pre-load weights for the given (kind, model_id, backend). Held
    in memory until ``unload_model`` or ``shutdown``.

    Slice 3 stub — accepts the call and records intent so the protocol
    works end-to-end, but doesn't actually load anything. Slice 4
    replaces with real loaders per kind."""
    with _LOADED_LOCK:
        _LOADED.clear()
        _LOADED["kind"] = kind
        _LOADED["model_id"] = model_id
        _LOADED["backend"] = backend
        _LOADED["loaded"] = False
        _LOADED["status"] = "stub_recorded"
    _log(f"load_model({kind=}, {model_id=}, {backend=}) — stub")
    return dict(_LOADED)


def unload_model() -> dict:
    with _LOADED_LOCK:
        previous = dict(_LOADED)
        _LOADED.clear()
    _log(f"unload_model — previous={previous!r}")
    return {"unloaded": previous}


def loaded_model() -> dict:
    """Read-only snapshot of what's currently loaded."""
    with _LOADED_LOCK:
        return dict(_LOADED)


# Per-kind inference stubs — slice 4 implements these for real.

def embed_clap(model_id: str, audio_path: str) -> dict:
    """Zero-shot audio classification via CLAP. Returns ranked (label, confidence) pairs.

    The sidecar downloaded the HF snapshot to ~/.music-hub-data/ml-models/<safe_id>/.
    We load from there (not via laion_clap's built-in download).

    CLAP categories are the same hardcoded set as in naming.py.
    """
    try:
        from transformers import ClapModel, ClapProcessor
    except ImportError as e:
        return {
            "results": None,
            "error": f"transformers not available; run `uv sync --extra embedding`: {e}",
        }

    # Category prompts (matches naming.py's CLAP_CATEGORIES)
    CLAP_CATEGORIES = [
        ("a kick drum sample", "kick"),
        ("a snare drum sample", "snare"),
        ("a hi-hat sample", "hat"),
        ("a cymbal sample", "cymbal"),
        ("a percussion hit", "perc"),
        ("a bass sound", "bass"),
        ("a sub bass sound", "sub"),
        ("a synth lead sound", "lead"),
        ("a pad or ambient drone", "pad"),
        ("a chord progression", "chord"),
        ("a melodic phrase", "melody"),
        ("a vocal recording", "vocal"),
        ("a spoken voice", "voice"),
        ("a textural sound design element", "texture"),
        ("a noise or glitch sound", "noise"),
        ("an ambient drone", "drone"),
        ("a drum loop", "drum-loop"),
        ("a sound effect", "fx"),
        ("a field recording", "field"),
        ("an acoustic instrument", "acoustic"),
    ]

    try:
        ckpt_dir = _hf_snapshot_dir(model_id)
        if not (ckpt_dir / "config.json").is_file():
            return {
                "results": None,
                "error": f"No config.json in {ckpt_dir} — download via Settings first.",
            }

        # Load model + processor (lazy, reuse _LOADED cache)
        cache_key = f"clap:{model_id}"
        with _LOADED_LOCK:
            cached = _LOADED.get(cache_key)
            if cached is None:
                model = ClapModel.from_pretrained(str(ckpt_dir))
                processor = ClapProcessor.from_pretrained(str(ckpt_dir))
                cached = {"model": model, "processor": processor}
                _LOADED[cache_key] = cached
                _LOADED["kind"] = "clap"
                _LOADED["model_id"] = model_id
                _LOADED["loaded"] = True
            model = cached["model"]
            processor = cached["processor"]

        # Load audio and normalize
        import soundfile as sf
        import numpy as np
        import torch

        audio, sr = sf.read(audio_path, dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 48000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=48000)

        # Encode audio and text prompts
        prompts = [p for p, _ in CLAP_CATEGORIES]
        inputs = processor(audios=audio[None, :], return_tensors="pt")
        text_inputs = processor(text=prompts, return_tensors="pt")

        with torch.no_grad():
            audio_features = model.get_audio_features(**inputs)
            text_features = model.get_text_features(**text_inputs)

        # Normalize and compute cosine similarity
        audio_features = audio_features / np.linalg.norm(audio_features.cpu().numpy(), axis=1, keepdims=True)
        text_features = text_features / np.linalg.norm(text_features.cpu().numpy(), axis=1, keepdims=True)
        sims = (audio_features @ text_features.T).cpu().numpy()[0]

        # Rank by confidence
        ranked = [
            (CLAP_CATEGORIES[i][1], float(sims[i]))
            for i in range(len(sims))
        ]
        ranked.sort(key=lambda x: x[1], reverse=True)

        return {"results": ranked}
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"results": None, "error": f"CLAP inference failed: {e}"}


def transcribe_whisper(model_id: str, audio_path: str) -> dict:
    """Speech-to-text via faster-whisper. Returns full transcript."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        return {
            "transcript": None,
            "error": f"faster-whisper not available; run `uv sync --extra transcription`: {e}",
        }

    try:
        ckpt_dir = _hf_snapshot_dir(model_id)

        # Load model (lazy, reuse _LOADED cache)
        cache_key = f"whisper:{model_id}"
        with _LOADED_LOCK:
            cached = _LOADED.get(cache_key)
            if cached is None:
                # HF repos have original PyTorch weights, not CT2 format.
                # If we have model.bin (CT2), use the local path; otherwise fall back to size string.
                size = model_id.rsplit("-", 1)[-1]  # "openai/whisper-tiny" -> "tiny"
                if (ckpt_dir / "model.bin").is_file():
                    model = WhisperModel(str(ckpt_dir), device="cpu", compute_type="int8")
                else:
                    model = WhisperModel(size, device="cpu", compute_type="int8")
                cached = {"model": model}
                _LOADED[cache_key] = cached
                _LOADED["kind"] = "whisper"
                _LOADED["model_id"] = model_id
                _LOADED["loaded"] = True
            model = cached["model"]

        # Transcribe
        segments, _info = model.transcribe(audio_path, beam_size=1, language="en", vad_filter=True)
        text_parts: list[str] = []
        for seg in segments:
            text_parts.append(seg.text.strip())
        transcript = " ".join(p for p in text_parts if p).strip()

        return {
            "transcript": transcript if transcript else None,
        }
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"transcript": None, "error": f"Whisper transcription failed: {e}"}


def separate_demucs(model_id: str, audio_path: str, output_dir: str) -> dict:
    """Stem separation via demucs. Returns dict with paths to separated stems."""
    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except ImportError as e:
        return {
            "stems": None,
            "error": f"demucs not available; run `uv sync --extra stems`: {e}",
        }

    try:
        import torch
        import torchaudio
        from pathlib import Path
        short = model_id.rsplit("/", 1)[-1]  # "facebook/htdemucs" -> "htdemucs"

        cache_key = f"demucs:{model_id}"
        with _LOADED_LOCK:
            cached = _LOADED.get(cache_key)
            if cached is None:
                model = get_model(short)  # downloads to ~/.cache/torch/hub/
                model.eval()
                cached = {"model": model}
                _LOADED[cache_key] = cached
                _LOADED["kind"] = "demucs"
                _LOADED["model_id"] = model_id
                _LOADED["loaded"] = True
            model = cached["model"]

        target_sr = getattr(model, "samplerate", 44100)
        audio, sr = torchaudio.load(audio_path)
        if sr != target_sr:
            audio = torchaudio.transforms.Resample(sr, target_sr)(audio)
        if audio.shape[0] == 1:
            audio = audio.repeat(2, 1)

        # apply_model expects shape (batch, channels, time); returns (batch, sources, channels, time)
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        with torch.no_grad():
            sources = apply_model(model, audio[None, ...], device=device, progress=False)

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        stems = {}
        for stem_idx, stem_name in enumerate(model.sources):
            stem_audio = sources[0, stem_idx].cpu()
            stem_file = output_path / f"{stem_name}.wav"
            torchaudio.save(str(stem_file), stem_audio, target_sr)
            stems[stem_name] = str(stem_file)

        return {"stems": stems}
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"stems": None, "error": f"Demucs separation failed: {e}"}


def refine_llm_hf(model_id: str, prompt: str, max_new_tokens: int = 24) -> dict:
    """Run Qwen / similar HF causal-LM inference. Loads the model once
    per (model_id) and reuses across calls. Returns ``{"text": ...}``
    or ``{"text": None, "error": ...}``.

    The sidecar already snapshotted the weights to disk at
    ``~/.music-hub-data/ml-models/<safe_id>/`` via the existing
    HF download path; the worker reads from there. The frozen sidecar
    is responsible for downloading; the worker only loads.
    """
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch
    except ImportError as e:
        return {
            "text": None,
            "error": f"transformers/torch not available in runtime venv: {e}",
        }

    state_key = f"llm:{model_id}"
    with _LOADED_LOCK:
        cached = _LOADED.get(state_key)
        # First-time load: snapshot dir lives at the same canonical path
        # the sidecar uses. We replicate the layout instead of importing
        # sample_curation_api (the worker is intentionally self-contained).
        if cached is None:
            ckpt_dir = _hf_snapshot_dir(model_id)
            if not (ckpt_dir / "config.json").is_file():
                return {
                    "text": None,
                    "error": f"No config.json in {ckpt_dir} — download via Settings first.",
                }
            try:
                tok = AutoTokenizer.from_pretrained(str(ckpt_dir))
                model = AutoModelForCausalLM.from_pretrained(
                    str(ckpt_dir),
                    dtype=torch.float32,  # transformers 5.x naming
                )
                model.eval()
            except Exception as e:
                return {"text": None, "error": f"load failed: {e}"}
            cached = {"tokenizer": tok, "model": model}
            _LOADED[state_key] = cached
            _LOADED["kind"] = "llm"
            _LOADED["model_id"] = model_id
            _LOADED["backend"] = "hf"
            _LOADED["loaded"] = True
        tok = cached["tokenizer"]
        model = cached["model"]

    try:
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
                max_new_tokens=max_new_tokens,
                do_sample=False,
                pad_token_id=getattr(tok, "pad_token_id", None) or tok.eos_token_id,
            )
        new_tokens = output[0][input_ids.shape[-1]:]
        text = tok.decode(new_tokens, skip_special_tokens=True)
        return {"text": text}
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"text": None, "error": f"generate failed: {e}"}


def _hf_snapshot_dir(model_id: str):
    """Mirror ``models._model_path`` so the worker reads from the same
    location the sidecar wrote to. Kept inline (not imported) so the
    worker stays self-contained."""
    from pathlib import Path
    safe = model_id.replace("/", "__")
    return Path.home() / ".music-hub-data" / "ml-models" / safe


def _not_implemented(method: str, **ctx: Any) -> dict:
    return {
        "status": "not_implemented",
        "method": method,
        "context": ctx,
        "note": "ml_worker slice 3 (skeleton). slice 4 wires the real loaders.",
    }


# ---------- Dispatch + main loop ----------

HANDLERS: dict[str, Callable[..., Any]] = {
    "ping": ping,
    "system_info": system_info,
    "load_model": load_model,
    "unload_model": unload_model,
    "loaded_model": loaded_model,
    "embed_clap": embed_clap,
    "transcribe_whisper": transcribe_whisper,
    "separate_demucs": separate_demucs,
    "refine_llm_hf": refine_llm_hf,
}


def _handle(request: dict) -> dict:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}
    if method == "shutdown":
        # Special-cased: respond, then the main loop breaks.
        return {"jsonrpc": "2.0", "result": "bye", "id": request_id}

    if method not in HANDLERS:
        return {
            "jsonrpc": "2.0",
            "error": {"code": -32601, "message": f"Method not found: {method}"},
            "id": request_id,
        }

    try:
        result = HANDLERS[method](**params)
        return {"jsonrpc": "2.0", "result": result, "id": request_id}
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        return {
            "jsonrpc": "2.0",
            "error": {"code": -32000, "message": str(exc)},
            "id": request_id,
        }


def main() -> None:
    _log(f"started (pid={threading.get_ident()})")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            err = {
                "jsonrpc": "2.0",
                "error": {"code": -32700, "message": f"Parse error: {exc}"},
                "id": None,
            }
            print(json.dumps(err), flush=True)
            continue

        response = _handle(request)
        print(json.dumps(response), flush=True)
        if request.get("method") == "shutdown":
            _log("shutdown received — exiting main loop")
            break


if __name__ == "__main__":
    main()
