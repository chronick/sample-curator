"""Recording name generation.

Given a freshly recorded audio file, produce a descriptive filename stem
such as ``dark-kick`` or ``autumn-waterfall``. Three paths, tried in order:

1. **CLAP zero-shot classification** — if ``laion-clap`` + ``torch`` are
   installed (``embedding`` extra). Matches a core set of ~20 sample
   categories. Only used when top-1 confidence clears ``CLAP_MIN_CONFIDENCE``.
2. **Librosa heuristic** — rough spectral+tempo features to guess one of
   a small handful of categories (kick, hat, bass, pad, texture, etc.).
   Depends only on librosa (already a sidecar dep).
3. **Heroku-style** — deterministic adjective-noun pair seeded from the
   input path. Works with zero ML deps; only used when both paths above
   decline to label.

The function returns a *stem* (no extension, no timestamp). Callers add
a timestamp suffix so filenames remain unique.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

# ~20 categories for CLAP zero-shot. Phrased as full noun phrases because
# CLAP's text encoder was trained on captions, not keywords.
CLAP_CATEGORIES: list[tuple[str, str]] = [
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

# Below this confidence we don't trust the CLAP result and fall through.
CLAP_MIN_CONFIDENCE = 0.30

# Heroku-style word lists. Kept short, evocative, and safe for filenames.
ADJECTIVES: list[str] = [
    "autumn", "silver", "amber", "crimson", "ember", "frosted", "hollow",
    "wild", "quiet", "violet", "midnight", "restless", "drifting", "muted",
    "soft", "brittle", "molten", "still", "dusty", "warm", "distant",
    "neon", "salted", "faded", "gilded", "rusted", "hushed", "winter",
    "summer", "coastal", "feral", "rolling", "forgotten", "tangled",
    "tidal", "paper", "velvet", "lingering", "cobalt", "copper",
    "fractured", "slanted", "sunken", "coral", "glassy", "stormy",
    "granite", "blurred", "pine", "lantern",
]

NOUNS: list[str] = [
    "waterfall", "meadow", "engine", "cove", "shadow", "ember", "signal",
    "ridge", "lantern", "harbor", "valley", "thicket", "cipher", "beacon",
    "mosaic", "atlas", "cascade", "nocturne", "drift", "echo", "glacier",
    "grove", "tundra", "lagoon", "canyon", "eddy", "lattice", "archive",
    "mirror", "prism", "antler", "spire", "monsoon", "tempo", "fjord",
    "compass", "marsh", "strata", "bridge", "sparrow", "quarry", "orbit",
    "wavefront", "alcove", "coast", "tide", "hollow", "hymn", "plume",
    "kiln",
]


def heroku_style_stem(seed: str) -> str:
    """Deterministic ``adjective-noun`` pair derived from ``seed``.

    The same seed always maps to the same pair — this makes testing sane
    and also means re-running naming on the same file is idempotent.
    """
    h = hashlib.md5(seed.encode("utf-8")).digest()
    return f"{ADJECTIVES[h[0] % len(ADJECTIVES)]}-{NOUNS[h[1] % len(NOUNS)]}"


def _try_clap(path: str) -> list[tuple[str, float]] | None:
    """Zero-shot classify via CLAP. Returns ``[(label, conf), ...]`` sorted
    descending, or ``None`` if CLAP/torch aren't installed or inference fails.

    CLAP model is ~1.5GB. First call lazy-loads the checkpoint.
    """
    try:  # noqa: SIM105 — want a distinct except for diagnostics
        import laion_clap  # type: ignore
        import numpy as np  # noqa: F401
    except Exception:
        return None

    try:
        model = _get_clap_model(laion_clap)
        # CLAP expects mono float32 at 48kHz. Use soundfile to load.
        import soundfile as sf

        audio, sr = sf.read(path, dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 48000:
            import librosa

            audio = librosa.resample(audio, orig_sr=sr, target_sr=48000)

        prompts = [p for p, _ in CLAP_CATEGORIES]
        audio_emb = model.get_audio_embedding_from_data(x=audio[None, :])
        text_emb = model.get_text_embedding(prompts)
        # Cosine similarity
        import numpy as np

        audio_emb = audio_emb / np.linalg.norm(audio_emb, axis=1, keepdims=True)
        text_emb = text_emb / np.linalg.norm(text_emb, axis=1, keepdims=True)
        sims = (audio_emb @ text_emb.T)[0]
        ranked = sorted(
            [(CLAP_CATEGORIES[i][1], float(s)) for i, s in enumerate(sims)],
            key=lambda pair: pair[1],
            reverse=True,
        )
        return ranked
    except Exception as e:
        log.warning("CLAP inference failed: %s", e)
        return None


_CLAP_MODEL = None


def _get_clap_model(laion_clap_mod) -> object:
    """Lazy-load the CLAP checkpoint once per process."""
    global _CLAP_MODEL
    if _CLAP_MODEL is None:
        _CLAP_MODEL = laion_clap_mod.CLAP_Module(enable_fusion=False)
        _CLAP_MODEL.load_ckpt()
    return _CLAP_MODEL


def _heuristic_tag(path: str) -> str | None:
    """Guess a coarse category from cheap spectral/temporal features.

    Returns one of ``kick``, ``hat``, ``bass``, ``pad``, ``texture``,
    ``loop``, or ``None`` if analysis fails.
    """
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(path, sr=22050, mono=True, duration=6.0)
        if y.size < sr // 4:  # < 250ms, too short to classify
            return None

        rms = float(np.sqrt(np.mean(y**2)))
        if rms < 1e-4:
            return None

        # Duration, ZCR, centroid, tempo
        dur_s = y.size / sr
        centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
        zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo = float(librosa.feature.tempo(onset_envelope=onset_env, sr=sr)[0])

        # Dumb decision tree. Tuned to be "better than generic session" not
        # "actually correct". CLAP handles the real classification when available.
        if dur_s < 0.6:
            if centroid > 5000 or zcr > 0.25:
                return "hat"
            if centroid < 700:
                return "kick"
            return "perc"
        if dur_s > 2.5 and tempo > 60:
            return "loop"
        if centroid < 500:
            return "bass"
        if centroid > 3500 and rms < 0.1:
            return "texture"
        if dur_s > 1.5 and centroid < 2000:
            return "pad"
        return None
    except Exception as e:
        log.warning("Heuristic naming failed: %s", e)
        return None


def name_recording(
    path: str,
    bpm: float | None = None,
    key: str | None = None,
    use_clap: bool = True,
) -> dict:
    """Produce a descriptive filename stem for a fresh recording.

    Args:
        path: Absolute path to the recorded WAV file.
        bpm: Optional pre-computed BPM. Appended to the stem if present.
        key: Optional pre-computed musical key (e.g. "Am"). Appended to stem.
        use_clap: If False, skip CLAP and use only heuristic + heroku paths.
            Useful for tests and for power users who don't want the ~1.5GB
            model download.

    Returns:
        Dict with keys ``stem``, ``tags`` (list of str), and ``method``
        (one of ``"clap"``, ``"heuristic"``, ``"heroku"``).
    """
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    seed = Path(path).stem
    tags: list[str] = []
    method = "heroku"
    base: str | None = None

    if use_clap:
        clap_result = _try_clap(path)
        if clap_result and clap_result[0][1] >= CLAP_MIN_CONFIDENCE:
            top_tag = clap_result[0][0]
            tags = [t for t, c in clap_result[:3] if c >= 0.2]
            base = top_tag
            method = "clap"

    if base is None:
        heur = _heuristic_tag(path)
        if heur:
            base = heur
            tags = [heur]
            method = "heuristic"

    if base is None:
        base = heroku_style_stem(seed)

    # Append BPM/key suffixes if provided by the caller (usually from
    # the Rust-side analyzers that already ran on the recording).
    parts = [base]
    if bpm and bpm > 0:
        parts.append(f"{int(round(bpm))}bpm")
    if key:
        # Sanitize: only allow a-zA-Z0-9-
        safe_key = "".join(c for c in key if c.isalnum() or c == "-")
        if safe_key:
            parts.append(safe_key)

    return {"stem": "_".join(parts), "tags": tags, "method": method}
