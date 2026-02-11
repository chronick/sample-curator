"""Rust-backed analyzer adapters.

This module provides BaseAnalyzer subclasses that wrap the high-performance
Rust implementations from sample_analysis_native.

These analyzers provide the same interface as pure Python analyzers but
use the native Rust code for significantly better performance.
"""

from pathlib import Path
from typing import Any

from sample_analysis.analyzers import register_analyzer
from sample_analysis.analyzers.base import BaseAnalyzer, AnalysisError
from sample_analysis.models import (
    BPMResult,
    KeyResult,
    QualityResult,
    SpectralResult,
    SpectrogramResult,
    TransientResult,
    LoopResult,
    AudioInfo,
)

# Try to import the native module
try:
    import sample_analysis_native as native
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False


def _check_native():
    """Raise error if native module not available."""
    if not NATIVE_AVAILABLE:
        raise AnalysisError(
            "Native Rust analyzers not available. "
            "Install with: pip install sample-analysis-native"
        )


@register_analyzer("bpm")
class RustBPMAnalyzer(BaseAnalyzer):
    """Rust-backed BPM detector.

    Uses the high-performance Rust implementation for BPM detection.
    Significantly faster than the librosa-based Python implementation.
    """

    @property
    def name(self) -> str:
        return "bpm"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        include_beats: bool = False,
        start_bpm: float = 120.0,
        **kwargs,
    ) -> BPMResult:
        """Analyze BPM from audio file.

        Args:
            audio_path: Path to audio file.
            include_beats: If True, include beat positions.
            start_bpm: Starting BPM estimate.
            **kwargs: Additional arguments (unused).

        Returns:
            BPMResult with detected tempo.
        """
        _check_native()

        result = native.bpm_analyze(
            str(audio_path),
            include_beats=include_beats,
            start_bpm=start_bpm,
        )

        return BPMResult(
            bpm=result["bpm"],
            confidence=result["confidence"],
            beat_frames=result.get("beat_frames"),
            beat_times=result.get("beat_times"),
        )


@register_analyzer("key")
class RustKeyAnalyzer(BaseAnalyzer):
    """Rust-backed musical key detector.

    Uses the high-performance Rust implementation for key detection.
    """

    @property
    def name(self) -> str:
        return "key"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        include_chroma: bool = False,
        num_alternates: int = 3,
        **kwargs,
    ) -> KeyResult:
        """Analyze musical key from audio file.

        Args:
            audio_path: Path to audio file.
            include_chroma: If True, include chroma profile.
            num_alternates: Number of alternate keys to return.
            **kwargs: Additional arguments (unused).

        Returns:
            KeyResult with detected key.
        """
        _check_native()

        result = native.key_analyze(
            str(audio_path),
            include_chroma=include_chroma,
            num_alternates=num_alternates,
        )

        # Convert alternate keys from tuples
        alternate_keys = []
        if "alternate_keys" in result:
            for alt in result["alternate_keys"]:
                # Rust returns (key, mode, confidence) tuples
                key_str = f"{alt[0]}{alt[1][0].lower()}"  # e.g., "Am" or "C"
                alternate_keys.append((key_str, alt[2]))

        return KeyResult(
            key=result["key"],
            mode=result["mode"],
            confidence=result["confidence"],
            alternate_keys=alternate_keys,
            chroma_profile=result.get("chroma_profile"),
        )


@register_analyzer("quality")
class RustQualityAnalyzer(BaseAnalyzer):
    """Rust-backed audio quality analyzer.

    Analyzes audio quality metrics like RMS, peak levels, crest factor, etc.
    """

    @property
    def name(self) -> str:
        return "quality"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        clipping_threshold: float = 0.99,
        **kwargs,
    ) -> QualityResult:
        """Analyze audio quality metrics.

        Args:
            audio_path: Path to audio file.
            clipping_threshold: Threshold for detecting clipping.
            **kwargs: Additional arguments (unused).

        Returns:
            QualityResult with quality metrics.
        """
        _check_native()

        result = native.quality_analyze(
            str(audio_path),
            clipping_threshold=clipping_threshold,
        )

        return QualityResult(
            rms_db=result["rms_db"],
            peak_db=result["peak_db"],
            crest_factor=result["crest_factor"],
            dynamic_range=result["dynamic_range"],
            clipping_detected=result["clipping_detected"],
            clipping_ratio=result.get("clipping_ratio", 0.0),
            dc_offset=result.get("dc_offset", 0.0),
        )


@register_analyzer("spectral")
class RustSpectralAnalyzer(BaseAnalyzer):
    """Rust-backed spectral feature analyzer.

    Analyzes spectral features like centroid, rolloff, bandwidth, MFCCs.
    """

    @property
    def name(self) -> str:
        return "spectral"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        n_mfcc: int = 13,
        include_mfcc: bool = True,
        **kwargs,
    ) -> SpectralResult:
        """Analyze spectral features.

        Args:
            audio_path: Path to audio file.
            n_mfcc: Number of MFCCs to extract.
            include_mfcc: If True, include MFCC values.
            **kwargs: Additional arguments (unused).

        Returns:
            SpectralResult with spectral features.
        """
        _check_native()

        result = native.spectral_analyze(str(audio_path), n_mfcc=n_mfcc)

        return SpectralResult(
            spectral_centroid=result["spectral_centroid"],
            spectral_rolloff=result["spectral_rolloff"],
            spectral_bandwidth=result["spectral_bandwidth"],
            spectral_flatness=result["spectral_flatness"],
            zero_crossing_rate=result["zero_crossing_rate"],
            mfccs=result.get("mfccs") if include_mfcc else None,
        )


@register_analyzer("spectrogram")
class RustSpectrogramAnalyzer(BaseAnalyzer):
    """Rust-backed spectrogram generator.

    Generates mel spectrograms for visualization.
    """

    @property
    def name(self) -> str:
        return "spectrogram"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        width: int = 800,
        height: int = 128,
        **kwargs,
    ) -> SpectrogramResult:
        """Generate mel spectrogram.

        Args:
            audio_path: Path to audio file.
            width: Output width (time frames).
            height: Output height (frequency bins).
            **kwargs: Additional arguments (unused).

        Returns:
            SpectrogramResult with 2D spectrogram data.
        """
        _check_native()

        result = native.spectrogram_analyze(str(audio_path), width=width, height=height)

        return SpectrogramResult(
            spectrogram=result["spectrogram"],
            duration=result["duration"],
            width=result["width"],
            height=result["height"],
            sample_rate=result.get("sample_rate"),
        )


@register_analyzer("transient")
class RustTransientAnalyzer(BaseAnalyzer):
    """Rust-backed transient/onset detector.

    Detects transients and onsets in audio.
    """

    @property
    def name(self) -> str:
        return "transient"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        backtrack: bool = True,
        include_strengths: bool = False,
        **kwargs,
    ) -> TransientResult:
        """Detect transients/onsets.

        Args:
            audio_path: Path to audio file.
            backtrack: If True, backtrack to onset start.
            include_strengths: If True, include onset strength values.
            **kwargs: Additional arguments (unused).

        Returns:
            TransientResult with onset positions.
        """
        _check_native()

        result = native.transient_analyze(
            str(audio_path),
            backtrack=backtrack,
            include_strengths=include_strengths,
        )

        return TransientResult(
            onset_frames=result["onset_frames"],
            onset_times=result["onset_times"],
            onset_strengths=result.get("onset_strengths"),
            num_onsets=result["num_onsets"],
        )


@register_analyzer("loop")
class RustLoopAnalyzer(BaseAnalyzer):
    """Rust-backed loop quality analyzer.

    Analyzes how well audio will loop and finds optimal loop points.
    """

    @property
    def name(self) -> str:
        return "loop"

    def is_available(self) -> bool:
        return NATIVE_AVAILABLE

    def analyze(
        self,
        audio_path: Path,
        min_quality_threshold: float = 0.7,
        **kwargs,
    ) -> LoopResult:
        """Analyze loop quality.

        Args:
            audio_path: Path to audio file.
            min_quality_threshold: Minimum quality to consider loopable.
            **kwargs: Additional arguments (unused).

        Returns:
            LoopResult with loop quality analysis.
        """
        _check_native()

        result = native.loop_analyze(
            str(audio_path),
            min_quality_threshold=min_quality_threshold,
        )

        return LoopResult(
            is_loopable=result["is_loopable"],
            loop_start_sample=result["loop_start_sample"],
            loop_end_sample=result["loop_end_sample"],
            quality_score=result["quality_score"],
            spectral_continuity=result["spectral_continuity"],
            amplitude_continuity=result["amplitude_continuity"],
            zero_crossing_aligned=result.get("zero_crossing_aligned", False),
        )


# Utility function for audio info (not an analyzer but useful)
def get_audio_info(audio_path: Path) -> AudioInfo:
    """Get basic audio file information using Rust backend.

    Args:
        audio_path: Path to audio file.

    Returns:
        AudioInfo with file metadata.
    """
    _check_native()

    result = native.audio_info(str(audio_path))

    return AudioInfo(
        path=result["path"],
        duration_sec=result["duration_sec"],
        sample_rate=result["sample_rate"],
        channels=result["channels"],
        bit_depth=result.get("bit_depth"),
        format=result.get("format"),
    )


def generate_waveform(audio_path: Path, width: int = 800) -> list[float]:
    """Generate waveform data for visualization using Rust backend.

    Args:
        audio_path: Path to audio file.
        width: Number of samples in output.

    Returns:
        List of amplitude values.
    """
    _check_native()
    return native.waveform_generate(str(audio_path), width=width)
