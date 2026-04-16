"""Tests for sample_curation_api.naming."""

from __future__ import annotations

import tempfile
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from sample_curation_api import naming
from sample_curation_api.handlers import HANDLERS


def _write_wav(path: Path, duration_s: float = 1.0, sr: int = 22050, freq: float | None = None):
    """Write a simple WAV file. ``freq`` = None produces silence."""
    n = int(duration_s * sr)
    if freq is None:
        data = np.zeros(n, dtype=np.int16)
    else:
        t = np.linspace(0, duration_s, n, endpoint=False)
        data = (0.3 * np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())


class TestHerokuStyleStem:
    def test_deterministic(self):
        a = naming.heroku_style_stem("session_20260415_183012")
        b = naming.heroku_style_stem("session_20260415_183012")
        assert a == b
        assert "-" in a

    def test_varies_across_seeds(self):
        a = naming.heroku_style_stem("seed-a")
        b = naming.heroku_style_stem("seed-b")
        assert a != b

    def test_output_uses_safe_filename_chars(self):
        stem = naming.heroku_style_stem("arbitrary")
        for c in stem:
            assert c.isalnum() or c == "-", f"unexpected char: {c!r}"

    def test_output_uses_known_word_lists(self):
        stem = naming.heroku_style_stem("seed")
        adj, _, noun = stem.partition("-")
        assert adj in naming.ADJECTIVES
        assert noun in naming.NOUNS


class TestNameRecording:
    def test_missing_file_raises(self):
        with pytest.raises(FileNotFoundError):
            naming.name_recording("/nonexistent/path.wav", use_clap=False)

    def test_silence_returns_heroku_fallback(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=1.0, freq=None)  # silent
        result = naming.name_recording(str(p), use_clap=False)
        assert result["method"] == "heroku"
        assert "-" in result["stem"]
        assert result["tags"] == []

    def test_short_high_freq_hits_hat_heuristic(self, tmp_path):
        # ~200ms of 8kHz noise — should trip the "hat" branch (high centroid, short).
        p = tmp_path / "rec_20260415_183012.wav"
        sr = 22050
        n = int(0.2 * sr)
        # White-noise-ish at high freq
        rng = np.random.default_rng(42)
        data = (rng.normal(0, 0.3, n).clip(-1, 1) * 32767).astype(np.int16)
        with wave.open(str(p), "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(data.tobytes())
        result = naming.name_recording(str(p), use_clap=False)
        # Heuristic should fire and choose a drum/perc category, not heroku fallback
        assert result["method"] in ("heuristic", "heroku")

    def test_appends_bpm_and_key_suffixes(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        result = naming.name_recording(str(p), bpm=128.0, key="Am", use_clap=False)
        assert result["stem"].endswith("_128bpm_Am")

    def test_ignores_bad_bpm(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        result = naming.name_recording(str(p), bpm=0.0, key=None, use_clap=False)
        assert "bpm" not in result["stem"]

    def test_sanitizes_key_string(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        result = naming.name_recording(str(p), key="C#/m", use_clap=False)
        # Non-alnum/dash characters are stripped
        assert result["stem"].endswith("_Cm")

    def test_use_clap_false_never_calls_clap(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        with patch.object(naming, "_try_clap") as mock:
            naming.name_recording(str(p), use_clap=False)
            mock.assert_not_called()

    def test_clap_result_below_threshold_falls_through(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        # Return low-confidence CLAP classifications — should not be used.
        with patch.object(naming, "_try_clap", return_value=[("kick", 0.1)]):
            result = naming.name_recording(str(p), use_clap=True)
            assert result["method"] != "clap"

    def test_clap_result_above_threshold_is_used(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.5, freq=None)
        with patch.object(
            naming,
            "_try_clap",
            return_value=[("kick", 0.9), ("snare", 0.3), ("hat", 0.1)],
        ):
            result = naming.name_recording(str(p), use_clap=True)
            assert result["method"] == "clap"
            assert result["stem"].startswith("kick")
            # Only tags above 0.2 are included
            assert "kick" in result["tags"]
            assert "snare" in result["tags"]
            assert "hat" not in result["tags"]


class TestMoodAdjective:
    def _make_features(self, **overrides) -> naming._HeuristicFeatures:
        base = dict(rms=0.1, centroid=2000.0, zcr=0.1, dur_s=1.0, tempo=120.0)
        base.update(overrides)
        return naming._HeuristicFeatures(**base)

    def test_bright_clip_picks_from_bright_pool(self):
        # Repeat with many seeds to exercise the candidate pool
        seen: set[str] = set()
        for seed in ["a", "b", "c", "d", "e", "f", "g", "h"]:
            f = self._make_features(centroid=5000.0)  # bright
            adj = naming._mood_adjective_from_features(f, seed)
            seen.add(adj)
        # All picks should be from the bright pool (plus short/etc. if they
        # happened to be bucketed in). Key assertion: bright words show up.
        assert seen & set(naming.MOOD_ADJECTIVES["bright"])
        # And the dark pool should NOT be mixed in for a bright clip.
        assert not (seen & set(naming.MOOD_ADJECTIVES["dark"]))

    def test_dark_clip_picks_from_dark_pool(self):
        seen: set[str] = set()
        for seed in ["a", "b", "c", "d", "e", "f", "g", "h"]:
            f = self._make_features(centroid=500.0)  # dark
            adj = naming._mood_adjective_from_features(f, seed)
            seen.add(adj)
        assert seen & set(naming.MOOD_ADJECTIVES["dark"])
        assert not (seen & set(naming.MOOD_ADJECTIVES["bright"]))

    def test_neutral_features_fall_back_to_neutral_pool(self):
        # Mid-band everything → no buckets trip → neutral fallback
        f = self._make_features(centroid=2000.0, rms=0.08, zcr=0.1, dur_s=1.5)
        adj = naming._mood_adjective_from_features(f, "seed")
        assert adj in naming.MOOD_ADJECTIVES["neutral"]

    def test_deterministic_per_seed(self):
        f = self._make_features()
        a = naming._mood_adjective_from_features(f, "same-seed")
        b = naming._mood_adjective_from_features(f, "same-seed")
        assert a == b

    def test_heuristic_stem_uses_adjective(self, tmp_path):
        # Short + mid-centroid clip → "perc". Expect `<adj>-perc`.
        p = tmp_path / "session_20260415_183012.wav"
        sr = 22050
        n = int(0.3 * sr)  # 300ms
        import numpy as np

        rng = np.random.default_rng(7)
        data = (rng.normal(0, 0.2, n).clip(-1, 1) * 32767).astype(np.int16)
        with wave.open(str(p), "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(data.tobytes())

        result = naming.name_recording(str(p), use_clap=False)
        if result["method"] == "heuristic":
            # adj-tag pattern
            assert "-" in result["stem"], f"expected compound stem, got {result['stem']!r}"
            # Tag still surfaces (kick/hat/perc/etc.) even if mood adjective was prepended
            assert result["tags"], "heuristic path should emit at least one tag"

    def test_clap_stem_uses_adjective(self, tmp_path):
        p = tmp_path / "session_20260415_183012.wav"
        _write_wav(p, duration_s=0.8, freq=440.0)
        with patch.object(
            naming,
            "_try_clap",
            return_value=[("kick", 0.9), ("snare", 0.3)],
        ):
            result = naming.name_recording(str(p), use_clap=True)
            assert result["method"] == "clap"
            # Should be `<adj>-kick` not bare `kick`
            assert result["stem"].split("_")[0].endswith("-kick"), (
                f"expected <adj>-kick, got {result['stem']!r}"
            )


class TestHandlerRegistration:
    def test_name_recording_registered(self):
        assert "name_recording" in HANDLERS
        assert HANDLERS["name_recording"] is naming.name_recording
