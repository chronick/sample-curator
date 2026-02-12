"""Audio fingerprinting using Chromaprint.

This module provides audio fingerprinting for duplicate detection
and audio identification.
"""

import time
from pathlib import Path

from sample_analysis.analyzers import register_analyzer
from sample_analysis.analyzers.base import BaseAnalyzer, ModelNotAvailableError
from sample_analysis.models import FingerprintResult


@register_analyzer("fingerprint")
class FingerprintAnalyzer(BaseAnalyzer):
    """Audio fingerprinting using Chromaprint.

    Generates audio fingerprints that can be used for:
    - Duplicate detection
    - Audio identification
    - Finding similar versions of the same audio

    Note: Requires pyacoustid (which wraps chromaprint) to be installed.

    Example:
        >>> analyzer = FingerprintAnalyzer()
        >>> result = analyzer.analyze("sample.wav")
        >>> print(f"Fingerprint: {result.fingerprint[:50]}...")
    """

    @property
    def name(self) -> str:
        return "fingerprint"

    def is_available(self) -> bool:
        """Check if pyacoustid is installed."""
        try:
            import acoustid
            return True
        except ImportError:
            return False

    def analyze(
        self,
        audio_path: Path,
        **kwargs,
    ) -> FingerprintResult:
        """Generate audio fingerprint.

        Args:
            audio_path: Path to audio file.
            **kwargs: Additional arguments (unused).

        Returns:
            FingerprintResult with fingerprint string.

        Raises:
            ModelNotAvailableError: If pyacoustid is not installed.
        """
        if not self.is_available():
            raise ModelNotAvailableError(
                "Fingerprint analyzer requires pyacoustid. "
                "Install with: pip install pyacoustid"
            )

        import acoustid

        start_time = time.time()

        # Generate fingerprint
        duration, fingerprint = acoustid.fingerprint_file(str(audio_path))

        analysis_time = time.time() - start_time

        return FingerprintResult(
            fingerprint=fingerprint,
            duration=duration,
        )

    def compare(self, fp1: str, fp2: str) -> float:
        """Compare two fingerprints and return similarity.

        Args:
            fp1: First fingerprint string.
            fp2: Second fingerprint string.

        Returns:
            Similarity score (0-1).
        """
        if not self.is_available():
            raise ModelNotAvailableError(
                "Fingerprint analyzer requires pyacoustid. "
                "Install with: pip install pyacoustid"
            )

        import acoustid

        # Compare fingerprints using acoustid
        try:
            score = acoustid.compare_fingerprints(fp1, fp2)
            return float(score)
        except Exception:
            # If comparison fails, return 0
            return 0.0
