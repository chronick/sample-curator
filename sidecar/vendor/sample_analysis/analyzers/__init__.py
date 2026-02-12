"""Audio analysis module with pluggable analyzer backends.

This module provides a model-agnostic interface for audio analysis,
supporting multiple analysis types like BPM detection, key detection, etc.

Example:
    >>> from sample_analysis.analyzers import get_analyzer
    >>> bpm = get_analyzer("bpm")
    >>> result = bpm.analyze("kick.wav")
    >>> print(result.bpm, result.confidence)
"""

from sample_analysis.analyzers.base import (
    AnalysisError,
    AnalysisResult,
    AudioLoadError,
    BaseAnalyzer,
    ModelNotAvailableError,
)

# Registry of available analyzers
_ANALYZER_REGISTRY: dict[str, type["BaseAnalyzer"]] = {}


def register_analyzer(name: str):
    """Decorator to register an analyzer class.

    Args:
        name: Name to register the analyzer under.

    Returns:
        Decorator function.

    Example:
        @register_analyzer("my-analyzer")
        class MyAnalyzer(BaseAnalyzer):
            ...
    """
    def decorator(cls: type["BaseAnalyzer"]) -> type["BaseAnalyzer"]:
        _ANALYZER_REGISTRY[name] = cls
        return cls
    return decorator


def get_analyzer(
    name: str,
    sample_rate: int | None = None,
    mono: bool = True,
    **kwargs,
) -> "BaseAnalyzer":
    """Get an analyzer instance by name.

    Args:
        name: Analyzer name. Options:
            - "bpm": BPM detection and beat tracking (Rust)
            - "key": Musical key detection (Rust)
            - "quality": Audio quality metrics (Rust)
            - "spectral": Spectral features (Rust)
            - "spectrogram": Mel spectrogram generation (Rust)
            - "transient": Transient/onset detection (Rust)
            - "loop": Loop quality detection (Rust)
            - "embedding": CLAP embeddings for similarity (Python)
            - "fingerprint": Audio fingerprinting (Python)
        sample_rate: Target sample rate (None for native).
        mono: Convert to mono for analysis.
        **kwargs: Additional kwargs passed to the analyzer.

    Returns:
        Configured analyzer instance.

    Raises:
        ModelNotAvailableError: If the requested analyzer is not available.
    """
    if name not in _ANALYZER_REGISTRY:
        # Try lazy loading
        _lazy_load_analyzer(name)

    if name not in _ANALYZER_REGISTRY:
        available = list(_ANALYZER_REGISTRY.keys())
        raise ModelNotAvailableError(
            f"Analyzer '{name}' not available. "
            f"Available analyzers: {available}. "
            f"Install required extras (e.g., pip install sample-analysis[embedding])"
        )

    analyzer_class = _ANALYZER_REGISTRY[name]
    return analyzer_class(sample_rate=sample_rate, mono=mono, **kwargs)


def list_analyzers() -> list[str]:
    """List all available analyzer names.

    Returns:
        List of analyzer names that can be used with get_analyzer().
    """
    # Try to load all known analyzers
    known_analyzers = [
        "bpm", "key", "quality", "spectral", "spectrogram", "transient",
        "loop", "embedding", "fingerprint"
    ]
    for name in known_analyzers:
        try:
            _lazy_load_analyzer(name)
        except (ImportError, ModelNotAvailableError):
            pass

    return list(_ANALYZER_REGISTRY.keys())


def _lazy_load_analyzer(name: str) -> None:
    """Lazily load an analyzer module.

    Args:
        name: Analyzer name to load.

    Raises:
        ImportError: If the analyzer module cannot be loaded.
    """
    if name in _ANALYZER_REGISTRY:
        return

    # Rust-backed analyzers
    rust_analyzers = ["bpm", "key", "quality", "spectral", "spectrogram", "transient", "loop"]
    if name in rust_analyzers:
        # Import rust bridge - this registers all Rust-backed analyzers
        from sample_analysis.analyzers._rust_bridge import (
            RustBPMAnalyzer,
            RustKeyAnalyzer,
            RustQualityAnalyzer,
            RustSpectralAnalyzer,
            RustSpectrogramAnalyzer,
            RustTransientAnalyzer,
            RustLoopAnalyzer,
        )
        return

    # Python-only analyzers
    if name == "embedding":
        from sample_analysis.analyzers.embedding import EmbeddingAnalyzer

    elif name == "fingerprint":
        from sample_analysis.analyzers.fingerprint import FingerprintAnalyzer


__all__ = [
    "AnalysisError",
    "AnalysisResult",
    "AudioLoadError",
    "BaseAnalyzer",
    "ModelNotAvailableError",
    "get_analyzer",
    "list_analyzers",
    "register_analyzer",
]
