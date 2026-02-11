"""Audio segmentation tools.

This module provides functions to split audio files into segments
based on various criteria: silence detection, beat boundaries, and
acoustic change points.

All segmentation uses high-performance Rust implementations.

Example:
    >>> from sample_analysis.segmentation import segment_by_silence
    >>> chunks = segment_by_silence("recording.wav", threshold_db=-40)
    >>> for chunk in chunks:
    ...     print(f"{chunk.start_time:.2f}s - {chunk.end_time:.2f}s")
"""

from pathlib import Path
from typing import Optional

from sample_analysis.models import AudioChunk

# Try to import the native module
try:
    import sample_analysis_native as native
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False


def _check_native():
    """Raise error if native module not available."""
    if not NATIVE_AVAILABLE:
        raise RuntimeError(
            "Native Rust segmentation not available. "
            "Install with: pip install sample-analysis-native"
        )


def _chunks_from_dicts(chunk_dicts: list[dict]) -> list[AudioChunk]:
    """Convert list of dicts from Rust to AudioChunk models."""
    return [
        AudioChunk(
            start_sample=d["start_sample"],
            end_sample=d["end_sample"],
            start_time=d["start_time"],
            end_time=d["end_time"],
            duration=d["duration"],
            path=Path(d["path"]) if "path" in d and d["path"] else None,
        )
        for d in chunk_dicts
    ]


def segment_by_silence(
    audio_path: Path,
    silence_threshold_db: float = -40.0,
    min_silence_duration: float = 0.5,
    min_chunk_duration: float = 1.0,
    output_dir: Optional[Path] = None,
    export: bool = False,
) -> list[AudioChunk]:
    """Segment audio by detecting silence regions.

    Splits audio at points where silence (below threshold) exceeds
    the minimum silence duration.

    Args:
        audio_path: Path to audio file.
        silence_threshold_db: Threshold in dB below which audio is silent.
        min_silence_duration: Minimum duration of silence to split at.
        min_chunk_duration: Minimum duration of resulting chunks.
        output_dir: Directory to export chunks to (if export=True).
        export: If True, export chunks to files.

    Returns:
        List of AudioChunk objects describing the segments.

    Example:
        >>> chunks = segment_by_silence("recording.wav", threshold_db=-35)
        >>> print(f"Found {len(chunks)} segments")
    """
    _check_native()

    chunk_dicts = native.segment_silence(
        str(audio_path),
        silence_threshold_db=silence_threshold_db,
        min_silence_duration=min_silence_duration,
        min_chunk_duration=min_chunk_duration,
    )

    chunks = _chunks_from_dicts(chunk_dicts)

    # Export if requested
    if export and output_dir:
        chunks = _export_chunks(audio_path, chunks, output_dir)

    return chunks


def segment_by_beats(
    audio_path: Path,
    bars_per_chunk: int = 8,
    bpm: Optional[float] = None,
    output_dir: Optional[Path] = None,
    export: bool = False,
) -> list[AudioChunk]:
    """Segment audio at beat/bar boundaries.

    Splits audio into chunks of a specified number of bars,
    aligning to detected beats.

    Args:
        audio_path: Path to audio file.
        bars_per_chunk: Number of bars per chunk.
        bpm: BPM to use (auto-detected if None).
        output_dir: Directory to export chunks to (if export=True).
        export: If True, export chunks to files.

    Returns:
        List of AudioChunk objects describing the segments.

    Example:
        >>> chunks = segment_by_beats("track.wav", bars_per_chunk=4)
        >>> print(f"Created {len(chunks)} 4-bar segments")
    """
    _check_native()

    chunk_dicts = native.segment_beats(
        str(audio_path),
        bars_per_chunk=bars_per_chunk,
        bpm=bpm,
    )

    chunks = _chunks_from_dicts(chunk_dicts)

    # Export if requested
    if export and output_dir:
        chunks = _export_chunks(audio_path, chunks, output_dir)

    return chunks


def segment_by_changepoint(
    audio_path: Path,
    min_segment_duration: float = 30.0,
    n_segments: Optional[int] = None,
    method: str = "rbf",
    output_dir: Optional[Path] = None,
    export: bool = False,
) -> list[AudioChunk]:
    """Segment audio at acoustic change points.

    Uses change-point detection to find natural boundaries in audio,
    useful for splitting live recordings, DJ mixes, or long recordings
    into individual tracks.

    Args:
        audio_path: Path to audio file.
        min_segment_duration: Minimum segment duration in seconds.
        n_segments: Target number of segments (if None, auto-detect).
        method: Detection method ("rbf", "l2", "linear").
        output_dir: Directory to export chunks to (if export=True).
        export: If True, export chunks to files.

    Returns:
        List of AudioChunk objects describing the segments.

    Example:
        >>> chunks = segment_by_changepoint("liveset.wav")
        >>> for i, chunk in enumerate(chunks):
        ...     print(f"Song {i+1}: {chunk.duration:.1f}s")
    """
    _check_native()

    chunk_dicts = native.segment_changepoint(
        str(audio_path),
        min_segment_duration=min_segment_duration,
        n_segments=n_segments,
    )

    chunks = _chunks_from_dicts(chunk_dicts)

    # Export if requested
    if export and output_dir:
        chunks = _export_chunks(audio_path, chunks, output_dir)

    return chunks


def _export_chunks(
    source_path: Path,
    chunks: list[AudioChunk],
    output_dir: Path,
) -> list[AudioChunk]:
    """Export audio chunks to files.

    Args:
        source_path: Path to source audio file.
        chunks: List of chunks to export.
        output_dir: Directory to export to.

    Returns:
        Updated chunks with path field set.
    """
    import soundfile as sf
    import numpy as np

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load source audio
    audio, sr = sf.read(str(source_path))

    stem = source_path.stem
    suffix = source_path.suffix

    exported_chunks = []
    for i, chunk in enumerate(chunks):
        # Extract chunk audio
        chunk_audio = audio[chunk.start_sample:chunk.end_sample]

        # Write to file
        output_path = output_dir / f"{stem}_{i+1:03d}{suffix}"
        sf.write(str(output_path), chunk_audio, sr)

        # Update chunk with path
        exported_chunks.append(
            AudioChunk(
                start_sample=chunk.start_sample,
                end_sample=chunk.end_sample,
                start_time=chunk.start_time,
                end_time=chunk.end_time,
                duration=chunk.duration,
                path=output_path,
            )
        )

    return exported_chunks


__all__ = [
    "segment_by_silence",
    "segment_by_beats",
    "segment_by_changepoint",
]
