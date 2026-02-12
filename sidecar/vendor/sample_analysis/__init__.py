"""Sample Analysis - High-performance audio analysis toolkit.

This package provides audio analysis tools for electronic music production,
combining high-performance Rust implementations with Python ease-of-use.

Example:
    >>> from sample_analysis import get_analyzer
    >>> analyzer = get_analyzer("bpm")
    >>> result = analyzer.analyze("kick.wav")
    >>> print(f"BPM: {result.bpm}, Confidence: {result.confidence:.2%}")

Analyzers:
    - bpm: BPM detection and beat tracking (Rust)
    - key: Musical key detection (Rust)
    - quality: Audio quality metrics (Rust)
    - spectral: Spectral features like centroid, MFCCs (Rust)
    - spectrogram: Mel spectrogram generation (Rust)
    - transient: Transient/onset detection (Rust)
    - loop: Loop quality analysis (Rust)
    - embedding: CLAP semantic embeddings (Python, optional)
    - fingerprint: Audio fingerprinting (Python, optional)

Segmentation:
    - segment_by_silence: Split at silent regions
    - segment_by_beats: Split at beat/bar boundaries
    - segment_by_changepoint: Split at acoustic changes
"""

__version__ = "0.1.0"

# Check if native module is available
try:
    from sample_analysis._native import analyze_bpm
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False

# Lazy imports to minimize startup time
_lazy_imports = {
    # Analyzers
    "get_analyzer": "sample_analysis.analyzers",
    "list_analyzers": "sample_analysis.analyzers",
    "register_analyzer": "sample_analysis.analyzers",
    "BaseAnalyzer": "sample_analysis.analyzers",
    "AnalysisError": "sample_analysis.analyzers",
    "AudioLoadError": "sample_analysis.analyzers",
    "ModelNotAvailableError": "sample_analysis.analyzers",
    # Segmentation
    "segment_by_silence": "sample_analysis.segmentation",
    "segment_by_beats": "sample_analysis.segmentation",
    "segment_by_changepoint": "sample_analysis.segmentation",
    # Models
    "BPMResult": "sample_analysis.models",
    "KeyResult": "sample_analysis.models",
    "QualityResult": "sample_analysis.models",
    "SpectralResult": "sample_analysis.models",
    "SpectrogramResult": "sample_analysis.models",
    "TransientResult": "sample_analysis.models",
    "LoopResult": "sample_analysis.models",
    "EmbeddingResult": "sample_analysis.models",
    "FingerprintResult": "sample_analysis.models",
    "AudioInfo": "sample_analysis.models",
    "AudioChunk": "sample_analysis.models",
    "FullAnalysis": "sample_analysis.models",
}


def __getattr__(name: str):
    """Lazy import attributes on first access."""
    if name in _lazy_imports:
        module_path = _lazy_imports[name]
        import importlib
        module = importlib.import_module(module_path)
        return getattr(module, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    """List available attributes."""
    return list(_lazy_imports.keys()) + ["__version__", "NATIVE_AVAILABLE"]


__all__ = [
    "__version__",
    "NATIVE_AVAILABLE",
    # Analyzers
    "get_analyzer",
    "list_analyzers",
    "register_analyzer",
    "BaseAnalyzer",
    "AnalysisError",
    "AudioLoadError",
    "ModelNotAvailableError",
    # Segmentation
    "segment_by_silence",
    "segment_by_beats",
    "segment_by_changepoint",
    # Models
    "BPMResult",
    "KeyResult",
    "QualityResult",
    "SpectralResult",
    "SpectrogramResult",
    "TransientResult",
    "LoopResult",
    "EmbeddingResult",
    "FingerprintResult",
    "AudioInfo",
    "AudioChunk",
    "FullAnalysis",
]
