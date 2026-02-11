"""Pydantic models for sample library entities.

These models provide structured, validated representations of database
entities, making it easy to work with sample data in Python.
"""

from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


class Sample(BaseModel):
    """Sample record from the library.

    Attributes:
        id: Unique sample ID.
        path: File path to the audio file.
        source_type: How the sample was acquired (imported, generated, recorded).
        sample_type: Type of sample (kick, snare, bass, etc.).
        bpm: Detected tempo.
        key: Detected musical key.
        duration: Duration in seconds.
        sample_rate: Sample rate in Hz.
        channels: Number of audio channels.
        rms_db: RMS level in dB.
        peak_db: Peak level in dB.
        crest_factor: Peak-to-RMS ratio in dB.
        dynamic_range: Dynamic range in dB.
        clipping_detected: Whether clipping was detected.
        spectral_centroid: Spectral centroid in Hz.
        spectral_flatness: Spectral flatness (0-1).
        loop_quality: Loop seamlessness score (0-100).
        is_loopable: Whether the sample can loop cleanly.
        quality_score: Technical quality score (0-100).
        applicability_score: Overall applicability score (0-100).
        fingerprint: Audio fingerprint string.
        fingerprint_hash: SHA256 hash of fingerprint.
        duplicate_of_id: ID of original sample if this is a duplicate.
        pack_id: ID of the pack this sample belongs to.
        created_at: When the sample was added.
        updated_at: When the sample was last modified.
        analyzed_at: When analysis was run.
    """

    id: int
    path: str
    source_type: str = "imported"
    sample_type: Optional[str] = None

    # Audio properties
    bpm: Optional[float] = None
    key: Optional[str] = None
    duration: Optional[float] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None

    # Quality metrics
    rms_db: Optional[float] = None
    peak_db: Optional[float] = None
    crest_factor: Optional[float] = None
    dynamic_range: Optional[float] = None
    clipping_detected: Optional[bool] = None

    # Spectral metrics
    spectral_centroid: Optional[float] = None
    spectral_flatness: Optional[float] = None
    spectral_bandwidth: Optional[float] = None
    spectral_rolloff: Optional[float] = None

    # Loop analysis
    loop_quality: Optional[float] = None
    is_loopable: Optional[bool] = None

    # Scores
    quality_score: Optional[float] = None
    applicability_score: Optional[float] = None

    # Deduplication
    fingerprint: Optional[str] = None
    fingerprint_hash: Optional[str] = None
    duplicate_of_id: Optional[int] = None

    # Relations
    pack_id: Optional[int] = None

    # Timestamps
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    analyzed_at: Optional[str] = None

    @property
    def path_obj(self) -> Path:
        """Return path as Path object."""
        return Path(self.path)

    class Config:
        from_attributes = True


class Pack(BaseModel):
    """Pack/collection of samples.

    Attributes:
        id: Unique pack ID.
        name: Pack name.
        path: Directory path.
        source_type: Type of pack (folder, ableton_project, splice, vendor).
        vendor: Vendor name if applicable.
        sample_count: Number of samples in pack.
        avg_quality_score: Average quality score of samples.
        created_at: When the pack was added.
    """

    id: int
    name: str
    path: str
    source_type: str = "folder"
    vendor: Optional[str] = None
    sample_count: int = 0
    avg_quality_score: Optional[float] = None
    created_at: Optional[str] = None

    @property
    def path_obj(self) -> Path:
        """Return path as Path object."""
        return Path(self.path)

    class Config:
        from_attributes = True


class Tag(BaseModel):
    """Tag for categorizing samples.

    Attributes:
        id: Unique tag ID.
        name: Tag name.
    """

    id: int
    name: str

    class Config:
        from_attributes = True


class SimilarityResult(BaseModel):
    """Result from similarity search.

    Attributes:
        sample_id: ID of the similar sample.
        similarity: Similarity score (0-1, higher is more similar).
        distance: Distance in embedding space.
    """

    sample_id: int
    similarity: float
    distance: float


class CompatibilityResult(BaseModel):
    """Result from compatibility search.

    Attributes:
        sample_id: ID of the compatible sample.
        compatibility_score: Overall compatibility score (0-1).
    """

    sample_id: int
    compatibility_score: float


class AcousticTags(BaseModel):
    """Acoustic categorization tags.

    Attributes:
        brightness: Bright/neutral/dark.
        dynamics: Punchy/balanced/sustained.
        tonality: Tonal/mixed/noisy.
        duration: Short/medium/long.
        frequency_range: Sub/low/mid/high/full.
    """

    brightness: str
    dynamics: str
    tonality: str
    duration: str
    frequency_range: str
