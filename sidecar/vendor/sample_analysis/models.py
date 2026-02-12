"""Pydantic models for audio analysis results.

These models provide structured, validated output from analyzers,
making it easy to serialize results to JSON and use in downstream
processing pipelines.
"""

from pathlib import Path

from pydantic import BaseModel, Field


class BPMResult(BaseModel):
    """Result of BPM detection analysis.

    Attributes:
        bpm: Detected tempo in beats per minute.
        confidence: Confidence score (0-1) of the detection.
        beat_frames: Frame indices of detected beats (optional).
        beat_times: Times in seconds of detected beats (optional).
    """

    bpm: float
    confidence: float = Field(ge=0, le=1)
    beat_frames: list[int] | None = None
    beat_times: list[float] | None = None


class KeyResult(BaseModel):
    """Result of musical key detection.

    Attributes:
        key: Detected key (e.g., "Am", "C#m", "F").
        mode: Major or minor mode.
        confidence: Confidence score (0-1) of the detection.
        alternate_keys: List of alternate keys with their confidence scores.
        chroma_profile: 12-element chroma vector (optional).
    """

    key: str
    mode: str  # "major" or "minor"
    confidence: float = Field(ge=0, le=1)
    alternate_keys: list[tuple[str, float]] = Field(default_factory=list)
    chroma_profile: list[float] | None = None


class SpectralResult(BaseModel):
    """Result of spectral analysis.

    Attributes:
        spectral_centroid: Center of mass of the spectrum (brightness).
        spectral_rolloff: Frequency below which 85% of energy is contained.
        spectral_bandwidth: Spread of the spectrum around centroid.
        spectral_flatness: How noise-like vs tonal the signal is (0-1).
        zero_crossing_rate: Rate of sign changes in the signal.
        mfccs: Mel-frequency cepstral coefficients (optional).
    """

    spectral_centroid: float
    spectral_rolloff: float
    spectral_bandwidth: float
    spectral_flatness: float = Field(ge=0, le=1)
    zero_crossing_rate: float
    mfccs: list[float] | None = None


class QualityResult(BaseModel):
    """Result of audio quality metrics analysis.

    Attributes:
        rms_db: Root mean square level in dB.
        peak_db: Peak level in dB.
        crest_factor: Peak to RMS ratio in dB (indicates dynamics).
        dynamic_range: Difference between loudest and quietest parts in dB.
        clipping_detected: Whether clipping was detected.
        clipping_ratio: Ratio of clipped samples (0-1).
        dc_offset: DC offset of the signal.
    """

    rms_db: float
    peak_db: float
    crest_factor: float
    dynamic_range: float
    clipping_detected: bool
    clipping_ratio: float = Field(default=0.0, ge=0, le=1)
    dc_offset: float = 0.0


class TransientResult(BaseModel):
    """Result of transient/onset detection.

    Attributes:
        onset_frames: Frame indices of detected onsets.
        onset_times: Times in seconds of detected onsets.
        onset_strengths: Strength values for each onset (optional).
        num_onsets: Total number of detected onsets.
    """

    onset_frames: list[int]
    onset_times: list[float]
    onset_strengths: list[float] | None = None
    num_onsets: int


class LoopResult(BaseModel):
    """Result of loop quality analysis.

    Attributes:
        is_loopable: Whether the audio can loop cleanly.
        loop_start_sample: Suggested loop start point (sample index).
        loop_end_sample: Suggested loop end point (sample index).
        quality_score: Overall loop quality (0-1).
        spectral_continuity: How well spectrum matches at loop point (0-1).
        amplitude_continuity: How well amplitude matches at loop point (0-1).
        zero_crossing_aligned: Whether loop points are at zero crossings.
    """

    is_loopable: bool
    loop_start_sample: int
    loop_end_sample: int
    quality_score: float = Field(ge=0, le=1)
    spectral_continuity: float = Field(ge=0, le=1)
    amplitude_continuity: float = Field(ge=0, le=1)
    zero_crossing_aligned: bool = False


class EmbeddingResult(BaseModel):
    """Result of audio embedding extraction.

    Attributes:
        model: Name of the embedding model used.
        vector: The embedding vector.
        dimension: Dimension of the embedding.
    """

    model: str
    vector: list[float]
    dimension: int


class FingerprintResult(BaseModel):
    """Result of audio fingerprinting.

    Attributes:
        fingerprint: The audio fingerprint string (base64 chromaprint).
        duration: Duration of the analyzed audio in seconds.
    """

    fingerprint: str
    duration: float


class AudioInfo(BaseModel):
    """Basic audio file information.

    Attributes:
        path: Path to the audio file.
        duration_sec: Duration in seconds.
        sample_rate: Sample rate in Hz.
        channels: Number of audio channels.
        bit_depth: Bit depth (if available).
        format: Audio format (wav, mp3, etc.).
    """

    path: str
    duration_sec: float
    sample_rate: int
    channels: int
    bit_depth: int | None = None
    format: str | None = None


class FullAnalysis(BaseModel):
    """Combined analysis results from all analyzers.

    This model aggregates results from multiple analyzers into a single
    comprehensive analysis result.

    Attributes:
        info: Basic audio file information.
        bpm: BPM detection result.
        key: Key detection result.
        spectral: Spectral analysis result.
        quality: Audio quality metrics.
        transients: Transient detection result.
        loop: Loop quality analysis.
        embedding: Audio embedding result.
        fingerprint: Audio fingerprint.
    """

    info: AudioInfo
    bpm: BPMResult | None = None
    key: KeyResult | None = None
    spectral: SpectralResult | None = None
    quality: QualityResult | None = None
    transients: TransientResult | None = None
    loop: LoopResult | None = None
    embedding: EmbeddingResult | None = None
    fingerprint: FingerprintResult | None = None


class SpectrogramResult(BaseModel):
    """Result of mel spectrogram computation for visualization.

    Attributes:
        spectrogram: 2D array [frequency_bins][time_frames] of normalized values (0-1).
        duration: Duration of the audio in seconds.
        width: Number of time frames.
        height: Number of frequency bins.
        sample_rate: Sample rate of the audio.
    """

    spectrogram: list[list[float]]
    duration: float
    width: int
    height: int
    sample_rate: int | None = None


class AudioChunk(BaseModel):
    """A segment of audio extracted during segmentation.

    Attributes:
        start_sample: Start sample index.
        end_sample: End sample index.
        start_time: Start time in seconds.
        end_time: End time in seconds.
        duration: Duration in seconds.
        path: Path to exported chunk (if exported).
    """

    start_sample: int
    end_sample: int
    start_time: float
    end_time: float
    duration: float
    path: Path | None = None
