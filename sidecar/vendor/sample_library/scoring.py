"""Applicability scoring algorithm for sample quality and usability.

Computes weighted scores based on:
- Technical quality (35%): RMS level, crest factor, clipping
- Loop quality (25%): Seamless loop potential
- Spectral balance (20%): Centroid position, flatness
- Usability (20%): Duration, sample rate appropriateness

This module provides a Python API that delegates to Rust for performance,
with a pure-Python fallback if the native module is not available.
"""

from dataclasses import dataclass
from typing import Optional

# Try to use native Rust implementation
try:
    from sample_library_native import compute_score as _native_compute_score
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False

# Ideal ranges for scoring (Python fallback constants)
IDEAL_RMS_DB = -18.0
IDEAL_RMS_TOLERANCE = 6.0
IDEAL_CREST_MIN = 6.0
IDEAL_CREST_MAX = 12.0
IDEAL_CENTROID_HZ = 3000.0
CENTROID_TOLERANCE_HZ = 2000.0
MIN_USABLE_DURATION = 0.1
MAX_USABLE_DURATION = 30.0
MIN_SAMPLE_RATE = 44100


@dataclass
class ScoreComponents:
    """Individual score components for transparency."""

    quality: float  # 0-100
    loop: float  # 0-100
    spectral: float  # 0-100
    usability: float  # 0-100
    total: float  # 0-100 weighted


def compute_applicability_score(
    # Quality metrics
    rms_db: Optional[float] = None,
    peak_db: Optional[float] = None,
    crest_factor: Optional[float] = None,
    dynamic_range: Optional[float] = None,
    clipping_detected: Optional[bool] = None,
    # Loop metrics
    loop_quality: Optional[float] = None,
    is_loopable: Optional[bool] = None,
    # Spectral metrics
    spectral_centroid: Optional[float] = None,
    spectral_flatness: Optional[float] = None,
    # Usability metrics
    duration: Optional[float] = None,
    sample_rate: Optional[int] = None,
) -> ScoreComponents:
    """Compute overall applicability score with component breakdown.

    Weights:
    - Technical quality: 35%
    - Loop quality: 25%
    - Spectral balance: 20%
    - Usability: 20%

    Args:
        All metrics from analysis pipeline

    Returns:
        ScoreComponents with individual and total scores
    """
    if NATIVE_AVAILABLE:
        # Use native Rust implementation
        result = _native_compute_score(
            rms_db=rms_db,
            peak_db=peak_db,
            crest_factor=crest_factor,
            dynamic_range=dynamic_range,
            clipping_detected=clipping_detected,
            loop_quality=loop_quality,
            is_loopable=is_loopable,
            spectral_centroid=spectral_centroid,
            spectral_flatness=spectral_flatness,
            duration=duration,
            sample_rate=sample_rate,
        )
        return ScoreComponents(
            quality=result["quality"],
            loop=result["loop"],
            spectral=result["spectral"],
            usability=result["usability"],
            total=result["total"],
        )

    # Pure Python fallback
    quality = _compute_quality_score(
        rms_db, peak_db, crest_factor, dynamic_range, clipping_detected
    )
    loop = _compute_loop_score(loop_quality, is_loopable)
    spectral = _compute_spectral_score(spectral_centroid, spectral_flatness)
    usability = _compute_usability_score(duration, sample_rate)

    total = (quality * 0.35) + (loop * 0.25) + (spectral * 0.20) + (usability * 0.20)

    return ScoreComponents(
        quality=round(quality, 1),
        loop=round(loop, 1),
        spectral=round(spectral, 1),
        usability=round(usability, 1),
        total=round(total, 1),
    )


def score_sample(sample) -> ScoreComponents:
    """Convenience function to score a Sample model instance.

    Args:
        sample: Sample model (ORM or Pydantic) with analysis fields populated

    Returns:
        ScoreComponents with all scores
    """
    return compute_applicability_score(
        rms_db=getattr(sample, "rms_db", None),
        peak_db=getattr(sample, "peak_db", None),
        crest_factor=getattr(sample, "crest_factor", None),
        dynamic_range=getattr(sample, "dynamic_range", None),
        clipping_detected=getattr(sample, "clipping_detected", None),
        loop_quality=getattr(sample, "loop_quality", None),
        is_loopable=getattr(sample, "is_loopable", None),
        spectral_centroid=getattr(sample, "spectral_centroid", None),
        spectral_flatness=getattr(sample, "spectral_flatness", None),
        duration=getattr(sample, "duration", None),
        sample_rate=getattr(sample, "sample_rate", None),
    )


# =========================================================================
# Python fallback implementations
# =========================================================================


def _compute_quality_score(
    rms_db: Optional[float],
    peak_db: Optional[float],
    crest_factor: Optional[float],
    dynamic_range: Optional[float],
    clipping_detected: Optional[bool],
) -> float:
    """Compute technical quality score (0-100)."""
    if rms_db is None and crest_factor is None:
        return 50.0

    penalties = []

    if rms_db is not None:
        rms_deviation = abs(rms_db - IDEAL_RMS_DB)
        if rms_deviation <= IDEAL_RMS_TOLERANCE:
            rms_score = 100.0
        else:
            excess = rms_deviation - IDEAL_RMS_TOLERANCE
            rms_score = max(0, 100 - (excess * 5))
        penalties.append((0.4, rms_score))

    if crest_factor is not None:
        if IDEAL_CREST_MIN <= crest_factor <= IDEAL_CREST_MAX:
            crest_score = 100.0
        elif crest_factor < IDEAL_CREST_MIN:
            deficit = IDEAL_CREST_MIN - crest_factor
            crest_score = max(0, 100 - (deficit * 10))
        else:
            excess = crest_factor - IDEAL_CREST_MAX
            crest_score = max(0, 100 - (excess * 5))
        penalties.append((0.3, crest_score))

    if clipping_detected is not None:
        clipping_score = 0.0 if clipping_detected else 100.0
        penalties.append((0.2, clipping_score))

    if dynamic_range is not None:
        if dynamic_range >= 12:
            dr_score = 100.0
        elif dynamic_range >= 6:
            dr_score = 50 + ((dynamic_range - 6) / 6) * 50
        else:
            dr_score = (dynamic_range / 6) * 50
        penalties.append((0.1, dr_score))

    if not penalties:
        return 50.0

    total_weight = sum(p[0] for p in penalties)
    weighted_sum = sum(p[0] * p[1] for p in penalties)
    return weighted_sum / total_weight


def _compute_loop_score(
    loop_quality: Optional[float],
    is_loopable: Optional[bool],
) -> float:
    """Compute loop quality score (0-100)."""
    if loop_quality is not None:
        return min(100, max(0, loop_quality))

    if is_loopable is not None:
        return 75.0 if is_loopable else 25.0

    return 50.0


def _compute_spectral_score(
    spectral_centroid: Optional[float],
    spectral_flatness: Optional[float],
) -> float:
    """Compute spectral balance score (0-100)."""
    if spectral_centroid is None and spectral_flatness is None:
        return 50.0

    scores = []

    if spectral_centroid is not None:
        deviation = abs(spectral_centroid - IDEAL_CENTROID_HZ)
        if deviation <= CENTROID_TOLERANCE_HZ:
            centroid_score = 100.0 - (deviation / CENTROID_TOLERANCE_HZ * 30)
        else:
            excess = deviation - CENTROID_TOLERANCE_HZ
            centroid_score = max(0, 70 - (excess / 1000) * 20)
        scores.append((0.7, centroid_score))

    if spectral_flatness is not None:
        if 0.3 <= spectral_flatness <= 0.6:
            flatness_score = 100.0
        elif spectral_flatness < 0.3:
            flatness_score = 60 + (spectral_flatness / 0.3) * 40
        else:
            excess = spectral_flatness - 0.6
            flatness_score = max(50, 100 - excess * 100)
        scores.append((0.3, flatness_score))

    if not scores:
        return 50.0

    total_weight = sum(s[0] for s in scores)
    return sum(s[0] * s[1] for s in scores) / total_weight


def _compute_usability_score(
    duration: Optional[float],
    sample_rate: Optional[int],
) -> float:
    """Compute usability score (0-100)."""
    scores = []

    if duration is not None:
        if MIN_USABLE_DURATION <= duration <= MAX_USABLE_DURATION:
            duration_score = 100.0
        elif duration < MIN_USABLE_DURATION:
            duration_score = (duration / MIN_USABLE_DURATION) * 50
        else:
            excess = duration - MAX_USABLE_DURATION
            duration_score = max(20, 100 - (excess / 60) * 50)
        scores.append((0.6, duration_score))

    if sample_rate is not None:
        if sample_rate >= MIN_SAMPLE_RATE:
            sr_score = 100.0
        elif sample_rate >= 22050:
            sr_score = 70.0
        else:
            sr_score = 30.0
        scores.append((0.4, sr_score))

    if not scores:
        return 50.0

    total_weight = sum(s[0] for s in scores)
    return sum(s[0] * s[1] for s in scores) / total_weight
