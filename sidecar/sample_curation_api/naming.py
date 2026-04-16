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

# Heroku-style word lists. Evocative, safe for filenames, tuned for
# sonic/textural/atmospheric vibes rather than generic UUID-alternatives.
# Word count targets: ~150 adjectives, ~130 nouns — enough that collisions
# within a session are vanishingly rare even at a dozen takes/minute.
ADJECTIVES: list[str] = [
    # Atmospheric / weather
    "autumn", "winter", "summer", "coastal", "tidal", "stormy", "misty",
    "monsoon", "arctic", "tropical", "boreal", "alpine", "oceanic",
    "twilight", "dawn", "dusk", "midnight", "vernal", "glacial",
    "windswept", "sunlit", "moonlit", "starlit", "overcast", "humid",
    # Material / texture
    "brittle", "molten", "granite", "velvet", "paper", "glassy",
    "porcelain", "leather", "satin", "linen", "concrete", "cedar",
    "pine", "birch", "obsidian", "onyx", "marble", "copper",
    "cobalt", "silver", "gilded", "amber", "ivory", "ebony",
    "pewter", "quartz", "slate", "lacquered", "woven", "knotted",
    # Color / light
    "crimson", "violet", "teal", "saffron", "coral", "indigo",
    "emerald", "scarlet", "carmine", "sepia", "neon", "ember",
    "ashen", "dappled", "prismatic", "bioluminescent",
    # Energy / motion
    "drifting", "rolling", "restless", "lingering", "cascading",
    "unraveling", "spiraling", "pulsing", "wandering", "slanted",
    "tilted", "orbiting", "tumbling", "feral", "frantic",
    "skittering", "shuddering", "trembling", "rippling",
    # Temperature / mood
    "warm", "cool", "tepid", "smoldering", "frozen", "chilled",
    "simmering", "scorched", "frosted", "thawed",
    # Quiet / sparse
    "quiet", "hushed", "muted", "subdued", "soft", "gentle",
    "tender", "vacant", "hollow", "distant", "faint", "ghostly",
    "faded", "bleached",
    # Dense / loud
    "dense", "heavy", "sunken", "leaden", "brutal", "clamorous",
    "churning", "surging", "seething", "teeming",
    # Rough / aged
    "rusted", "tarnished", "weathered", "salted", "cracked",
    "splintered", "fractured", "worn", "patched", "stained",
    "bruised", "frayed", "mottled", "dusty", "faulty",
    # Natural / wild
    "wild", "tangled", "overgrown", "primal", "ancient",
    "forgotten", "buried", "submerged",
    # Precision / crafted
    "sharpened", "polished", "burnished", "etched", "carved",
    "hammered", "woven", "stitched", "threaded", "spun",
    # Shape / form
    "blurred", "warped", "bent", "curled", "spiraled",
    "knotted", "coiled", "folded",
    # Emotional / dreamlike
    "melancholy", "yearning", "hopeful", "wistful", "solemn",
    "reverent", "brooding", "serene", "elated",
    "lucid", "hazy", "dreaming", "sleeping", "waking",
    "dissolving", "suspended",
    # Abstract / cosmic
    "liminal", "spectral", "transient", "ephemeral",
    "infinite", "fractal", "crystalline", "holographic",
]

NOUNS: list[str] = [
    # Water / landscape
    "waterfall", "cascade", "glacier", "lagoon", "fjord", "tide",
    "coast", "estuary", "delta", "canyon", "crevasse",
    "valley", "ridge", "meadow", "grove", "thicket", "tundra",
    "marsh", "bog", "plateau", "mesa", "savanna", "steppe",
    "reef", "shoal", "harbor", "cove", "strand", "shore",
    # Sky / light
    "beacon", "lantern", "prism", "mirror", "halo", "aurora",
    "nebula", "comet", "constellation", "zenith", "horizon",
    "firefly", "moth", "ember", "cinder", "spark",
    # Sound / music
    "nocturne", "lullaby", "hymn", "reverie", "elegy",
    "cadence", "refrain", "chorus", "drone", "echo", "signal",
    "chime", "toll", "pulse", "heartbeat",
    # Movement / dynamic
    "drift", "current", "eddy", "wake", "wave",
    "wavefront", "gust", "breath", "whisper", "gale",
    "monsoon", "tempo", "pulse",
    # Shape / structure
    "lattice", "spire", "tower", "arch", "bridge", "vault",
    "column", "pillar", "gate", "arcade", "alcove", "atrium",
    "cloister", "mosaic", "cipher", "sigil",
    # Tools / objects
    "compass", "atlas", "archive", "ledger", "almanac",
    "parchment", "lens", "telescope", "kiln", "forge",
    "loom", "hearth", "quarry", "engine", "relic", "talisman",
    # Creatures / life
    "sparrow", "antler", "feather", "plume", "fawn",
    "minnow", "hare", "owl", "crow", "mantis",
    # Atmospheres / moods
    "shadow", "silhouette", "outline", "trace",
    "imprint", "residue", "remnant", "memory", "echo",
    # Paths / geometry
    "spiral", "orbit", "meridian", "trajectory",
    "corridor", "passage", "threshold",
    # Patterns
    "strata", "stratum", "layer", "veil", "weave",
    "pattern", "filigree",
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


# Mood-adjective pools keyed by spectral feature bucket. When the heuristic
# (or CLAP) produces a bare tag like "loop", we compose `{adjective}-{tag}`
# instead — far more evocative than the bare category word. Adjective is
# picked deterministically from the file's seed so re-running naming on the
# same file is idempotent.
MOOD_ADJECTIVES: dict[str, list[str]] = {
    # Brightness (spectral centroid)
    "bright": [
        "amber", "gilded", "silver", "crystal", "lantern", "neon",
        "prismatic", "sunlit", "saffron", "emerald", "glowing",
        "luminous", "gleaming", "burnished", "shimmering", "dazzling",
        "incandescent", "radiant",
    ],
    "dark": [
        "hollow", "sunken", "shadow", "midnight", "obsidian", "tar",
        "ebony", "onyx", "ashen", "subterranean", "buried", "submerged",
        "cavernous", "umbral", "slate", "pitch", "murky", "dusky",
    ],
    # Weight / body (RMS energy)
    "dense": [
        "molten", "heavy", "granite", "copper", "tidal", "leaden",
        "churning", "seething", "teeming", "brutal", "surging",
        "monolithic", "subterranean", "volcanic", "thunderous",
    ],
    "thin": [
        "paper", "drifting", "wisp", "tender", "faded", "ghostly",
        "gossamer", "transient", "ephemeral", "vaporous",
        "faint", "delicate", "threadbare", "translucent",
    ],
    # Edge / harshness (zero-crossing rate)
    "sharp": [
        "brittle", "fractured", "splintered", "glassy", "jagged",
        "serrated", "shattered", "etched", "crystalline", "bristling",
        "skittering", "clamorous",
    ],
    "smooth": [
        "velvet", "hushed", "muted", "tangled", "satin", "lacquered",
        "burnished", "seamless", "woven", "polished", "mellifluous",
        "buttered",
    ],
    # Temporal character
    "short": [
        "crisp", "punchy", "snapped", "struck", "clipped",
        "staccato", "taut", "abrupt", "sudden", "percussive",
    ],
    "long": [
        "lingering", "trailing", "rolling", "sustained", "enduring",
        "unfurling", "spiraling", "cascading", "wandering", "drifting",
        "meandering", "suspended",
    ],
    # Generic mid-band fallback when no feature is distinctive
    "neutral": [
        "dusty", "pine", "coastal", "autumn", "warm", "weathered",
        "worn", "patched", "mottled", "subdued", "tempered", "vernal",
        "temperate", "moderate", "aged",
    ],
}


class _HeuristicFeatures:
    """Cached acoustic features for one audio clip. Keeps the librosa load
    and feature extractions to a single pass; both ``_heuristic_tag`` and
    ``_mood_adjective_from_features`` read from the same struct."""

    __slots__ = ("rms", "centroid", "zcr", "dur_s", "tempo")

    def __init__(self, rms: float, centroid: float, zcr: float, dur_s: float, tempo: float):
        self.rms = rms
        self.centroid = centroid
        self.zcr = zcr
        self.dur_s = dur_s
        self.tempo = tempo


def _extract_features(path: str) -> _HeuristicFeatures | None:
    """Load the clip once and pull the four features we need. Returns
    ``None`` if the clip is too short/quiet to analyse."""
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(path, sr=22050, mono=True, duration=6.0)
        if y.size < sr // 4:  # < 250ms, too short
            return None

        rms = float(np.sqrt(np.mean(y**2)))
        if rms < 1e-4:
            return None

        dur_s = y.size / sr
        centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
        zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo = float(librosa.feature.tempo(onset_envelope=onset_env, sr=sr)[0])

        return _HeuristicFeatures(rms=rms, centroid=centroid, zcr=zcr, dur_s=dur_s, tempo=tempo)
    except Exception as e:
        log.warning("Feature extraction failed: %s", e)
        return None


def _heuristic_tag_from_features(f: _HeuristicFeatures) -> str | None:
    """Coarse category from the cached features. Returns one of ``kick``,
    ``hat``, ``perc``, ``bass``, ``pad``, ``texture``, ``loop``, or ``None``.

    Same decision tree as before — kept deliberately simple; CLAP handles
    the real classification when available.
    """
    if f.dur_s < 0.6:
        if f.centroid > 5000 or f.zcr > 0.25:
            return "hat"
        if f.centroid < 700:
            return "kick"
        return "perc"
    if f.dur_s > 2.5 and f.tempo > 60:
        return "loop"
    if f.centroid < 500:
        return "bass"
    if f.centroid > 3500 and f.rms < 0.1:
        return "texture"
    if f.dur_s > 1.5 and f.centroid < 2000:
        return "pad"
    return None


def _mood_adjective_from_features(f: _HeuristicFeatures, seed: str) -> str:
    """Pick a mood adjective by bucketing the features, then sampling
    deterministically from the candidate pool keyed by `seed`.

    The bucketing chooses *which* pools contribute candidates (a bright
    clip surfaces amber/gilded/silver; a thin+dark clip surfaces
    wisp/paper/hollow/shadow). The seed then picks a single word from
    the combined pool. Two clips with similar spectral content drift
    through similar adjective families while still having distinct names.
    """
    candidates: list[str] = []

    # Brightness bucket (spectral centroid)
    if f.centroid > 3000:
        candidates.extend(MOOD_ADJECTIVES["bright"])
    elif f.centroid < 800:
        candidates.extend(MOOD_ADJECTIVES["dark"])

    # Weight bucket (RMS)
    if f.rms > 0.15:
        candidates.extend(MOOD_ADJECTIVES["dense"])
    elif f.rms < 0.03:
        candidates.extend(MOOD_ADJECTIVES["thin"])

    # Edge bucket (ZCR)
    if f.zcr > 0.2:
        candidates.extend(MOOD_ADJECTIVES["sharp"])
    elif f.zcr < 0.05:
        candidates.extend(MOOD_ADJECTIVES["smooth"])

    # Temporal bucket
    if f.dur_s < 0.6:
        candidates.extend(MOOD_ADJECTIVES["short"])
    elif f.dur_s > 3.0:
        candidates.extend(MOOD_ADJECTIVES["long"])

    # Nothing stood out → fall back to the neutral pool so we still
    # produce *something* evocative instead of the bare tag.
    if not candidates:
        candidates = MOOD_ADJECTIVES["neutral"]

    h = hashlib.md5(seed.encode("utf-8")).digest()
    return candidates[h[2] % len(candidates)]


def _heuristic_tag(path: str) -> str | None:
    """Back-compat shim around the split feature/tag extractors. Returns
    a bare tag (no adjective) — callers that want the richer name should
    use :func:`_extract_features` + :func:`_heuristic_tag_from_features`
    + :func:`_mood_adjective_from_features` directly.
    """
    features = _extract_features(path)
    if features is None:
        return None
    return _heuristic_tag_from_features(features)


# Words to skip when pulling a stem out of a transcript. We want content
# words that carry meaning ("testing microphone" → "testing-microphone"),
# not filler ("um the uh you know what I mean" → garbage). Lowercased.
TRANSCRIPTION_STOPWORDS: frozenset[str] = frozenset({
    "the", "a", "an", "and", "or", "but", "so", "for", "with", "on", "in",
    "at", "to", "of", "by", "as", "is", "am", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "should", "could", "may", "might", "can", "must", "shall",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
    "them", "my", "your", "his", "hers", "its", "our", "their", "mine",
    "yours", "theirs", "this", "that", "these", "those", "what", "which",
    "who", "whom", "whose", "where", "when", "why", "how",
    "um", "uh", "er", "ah", "oh", "hmm", "mm", "like", "just", "really",
    "very", "okay", "ok", "yeah", "yes", "no", "nope", "well",
})


def _looks_like_speech(f: _HeuristicFeatures) -> bool:
    """Cheap pre-check before we fire up a Whisper model. Speech tends to
    sit in the 300-4500 Hz centroid band with moderate ZCR and decent RMS.
    Drum hits (very short + high ZCR) and pure drones (low ZCR, very stable
    centroid) get rejected here so we don't waste a transcription round-trip
    on non-vocal material.
    """
    if f.dur_s < 0.5:
        return False
    if f.rms < 0.005:
        return False
    if f.centroid < 300 or f.centroid > 4500:
        return False
    if f.zcr < 0.03 or f.zcr > 0.25:
        return False
    return True


_WHISPER_MODEL = None


def _get_whisper_model():
    """Lazy-load a tiny Whisper model on first use. ``tiny`` is ~75MB
    and transcribes ~30x realtime on CPU — more than fast enough for a
    handful-of-seconds sample.
    """
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        from faster_whisper import WhisperModel  # type: ignore

        _WHISPER_MODEL = WhisperModel("tiny", device="cpu", compute_type="int8")
    return _WHISPER_MODEL


def _transcribe_to_stem(path: str, max_words: int = 3) -> str | None:
    """Transcribe the clip via Whisper and extract up to `max_words` content
    words as a hyphenated filename stem. Returns ``None`` if faster-whisper
    isn't installed, the transcript is empty, or no content words survive
    the stopword/length filter.
    """
    try:
        import faster_whisper  # noqa: F401  (just the import check)
    except Exception:
        return None

    try:
        model = _get_whisper_model()
        # beam_size=1 is the fastest option; we don't need optimal decoding
        # for a filename. Language hint avoids misdetection on short clips.
        segments, _info = model.transcribe(path, beam_size=1, language="en", vad_filter=True)
        words: list[str] = []
        for seg in segments:
            for raw in seg.text.split():
                cleaned = "".join(c for c in raw.lower() if c.isalpha())
                if len(cleaned) < 3:
                    continue
                if cleaned in TRANSCRIPTION_STOPWORDS:
                    continue
                words.append(cleaned)
                if len(words) >= max_words:
                    break
            if len(words) >= max_words:
                break
        if not words:
            return None
        return "-".join(words)
    except Exception as e:
        log.warning("Whisper transcription failed for %s: %s", path, e)
        return None


VOCAL_TAGS: frozenset[str] = frozenset({"vocal", "voice"})


def name_recording(
    path: str,
    bpm: float | None = None,
    key: str | None = None,
    use_clap: bool = True,
    use_transcription: bool = True,
) -> dict:
    """Produce a descriptive filename stem for a fresh recording.

    Args:
        path: Absolute path to the recorded WAV file.
        bpm: Optional pre-computed BPM. Appended to the stem if present.
        key: Optional pre-computed musical key (e.g. "Am"). Appended to stem.
        use_clap: If False, skip CLAP and use only heuristic + heroku paths.
            Useful for tests and for power users who don't want the ~1.5GB
            model download.
        use_transcription: If False, skip Whisper transcription even when the
            clip looks like speech. Useful for tests and for power users who
            don't want to pull in the `transcription` extra.

    Returns:
        Dict with keys ``stem``, ``tags`` (list of str), and ``method``
        (one of ``"clap"``, ``"transcription"``, ``"heuristic"``, ``"heroku"``).
    """
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    seed = Path(path).stem
    tags: list[str] = []
    method = "heroku"
    base: str | None = None

    # Pull the heuristic features up-front: they feed both the tag decision
    # tree *and* the mood-adjective picker. Extracting once avoids loading
    # audio twice when both paths run.
    features = _extract_features(path)

    # Track whether CLAP has flagged the clip as vocal content — this is a
    # stronger signal than the cheap speech heuristic and takes priority.
    clap_says_vocal = False

    if use_clap:
        clap_result = _try_clap(path)
        if clap_result and clap_result[0][1] >= CLAP_MIN_CONFIDENCE:
            top_tag = clap_result[0][0]
            tags = [t for t, c in clap_result[:3] if c >= 0.2]
            clap_says_vocal = top_tag in VOCAL_TAGS
            # Give CLAP names a mood adjective too when features are available.
            # `amber-kick` is more memorable than bare `kick`, and stays
            # deterministic per file so re-runs match.
            if features is not None:
                adj = _mood_adjective_from_features(features, seed)
                base = f"{adj}-{top_tag}"
            else:
                base = top_tag
            method = "clap"

    # Vocal-aware naming: if this looks like speech (CLAP said so, or the
    # cheap spectral heuristic says so), try to transcribe it and use the
    # first few content words as the stem. Produces names like
    # `testing-microphone` or `we-ride-eternal` that are far more useful for
    # recall than `amber-voice` or bare heuristic tags.
    if use_transcription and features is not None:
        looks_vocal = clap_says_vocal or _looks_like_speech(features)
        if looks_vocal:
            transcript_stem = _transcribe_to_stem(path)
            if transcript_stem:
                # When CLAP was confident the sample was vocal, preserve the
                # vocal tag alongside the transcript-derived name so library
                # search by tag still works.
                if clap_says_vocal:
                    # Keep existing CLAP tags (already populated above)
                    pass
                else:
                    tags = ["vocal"]
                base = transcript_stem
                method = "transcription"

    if base is None and features is not None:
        heur = _heuristic_tag_from_features(features)
        if heur:
            adj = _mood_adjective_from_features(features, seed)
            base = f"{adj}-{heur}"
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
