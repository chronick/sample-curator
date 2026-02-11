"""Base classes for audio analyzers.

This module defines the abstract interface that all analyzer backends
must implement, ensuring a consistent API across different analysis types.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class AnalysisError(Exception):
    """Base exception for analysis errors."""

    pass


class ModelNotAvailableError(AnalysisError):
    """Raised when required model/library is not installed."""

    pass


class AudioLoadError(AnalysisError):
    """Raised when audio file cannot be loaded."""

    pass


@dataclass
class AnalysisResult:
    """Base result with timing and metadata.

    All analyzer results inherit from or compose with this base class.

    Attributes:
        analyzer_name: Name of the analyzer that produced this result.
        duration_sec: Time taken to perform analysis in seconds.
        metadata: Additional metadata from analysis.
    """

    analyzer_name: str
    duration_sec: float
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAnalyzer(ABC):
    """Abstract base class for all audio analyzers.

    All analyzer implementations must inherit from this class and
    implement the required abstract methods.

    Example:
        class MyAnalyzer(BaseAnalyzer):
            @property
            def name(self) -> str:
                return "my-analyzer"

            def analyze(self, audio_path, **kwargs):
                # Implementation here
                pass

            def is_available(self) -> bool:
                return True
    """

    def __init__(
        self,
        sample_rate: int | None = None,
        mono: bool = True,
    ):
        """Initialize the analyzer.

        Args:
            sample_rate: Target sample rate for analysis. If None, uses native rate.
            mono: If True, convert stereo to mono before analysis.
        """
        self.sample_rate = sample_rate
        self.mono = mono

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the unique name of this analyzer."""
        pass

    @abstractmethod
    def analyze(self, audio_path: Path, **kwargs) -> Any:
        """Run analysis on an audio file.

        Args:
            audio_path: Path to the audio file to analyze.
            **kwargs: Additional analyzer-specific parameters.

        Returns:
            Analysis result (type depends on analyzer).

        Raises:
            AnalysisError: If analysis fails.
            AudioLoadError: If audio file cannot be loaded.
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this analyzer's dependencies are installed.

        Returns:
            True if the analyzer can be used.
        """
        pass

    def load_audio(self, audio_path: Path) -> tuple["np.ndarray", int]:
        """Load audio file for analysis.

        Args:
            audio_path: Path to audio file.

        Returns:
            Tuple of (audio_array, sample_rate).

        Raises:
            AudioLoadError: If audio cannot be loaded.
        """
        try:
            import librosa
        except ImportError:
            # Fall back to soundfile if librosa not available
            try:
                import soundfile as sf
                import numpy as np

                audio, sr = sf.read(str(audio_path))
                if self.mono and audio.ndim > 1:
                    audio = np.mean(audio, axis=1)
                if self.sample_rate and self.sample_rate != sr:
                    # Basic resampling without librosa
                    raise AudioLoadError(
                        "Resampling requires librosa. Install with: pip install librosa"
                    )
                return audio, sr
            except Exception as e:
                raise AudioLoadError(f"Failed to load audio: {e}") from e

        try:
            audio, sr = librosa.load(
                str(audio_path),
                sr=self.sample_rate,
                mono=self.mono,
            )
            return audio, sr
        except Exception as e:
            raise AudioLoadError(f"Failed to load audio: {e}") from e

    def _default_cache_dir(self) -> Path:
        """Return the default cache directory for models.

        Returns:
            Path to cache directory.
        """
        return Path("~/.music-hub-data/sample-analysis/cache").expanduser()
