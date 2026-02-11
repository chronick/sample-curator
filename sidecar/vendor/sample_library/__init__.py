"""Sample Library - High-performance sample management toolkit.

This package provides sample library operations for electronic music production,
combining high-performance Rust implementations with Python ease-of-use.

Example:
    >>> from sample_library import init_db, search_similar, batch_import
    >>> init_db()  # Uses default location
    >>> results = search_similar(sample_id=1, limit=10)

Features:
    - Database operations (Rust-backed SQLite)
    - Similarity search (usearch ANN)
    - Compatibility matching (key/BPM)
    - Acoustic categorization
    - Batch import with analysis
    - Applicability scoring
"""

__version__ = "0.1.0"

# Try to import native module
try:
    from sample_library._native import (
        # Database
        init_db,
        get_sample,
        get_sample_by_path,
        get_samples,
        get_samples_by_ids,
        count_samples,
        get_packs,
        get_tags,
        get_sample_tags,
        add_tag_to_sample,
        remove_tag_from_sample,
        insert_sample as _insert_sample,
        update_sample_analysis,
        get_or_create_pack,
        # Embeddings
        store_embedding,
        get_embedding,
        extract_embedding,
        get_samples_without_embeddings,
        generate_embeddings,
        # Search
        search_similar,
        find_compatible,
        # Categorization
        categorize,
        # Scoring
        compute_score,
        score_sample as score_sample_native,
    )
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False


def import_sample(
    path,
    tags: list[str] | None = None,
    source_type: str = "imported",
    sample_type: str | None = None,
    analyze: bool = False,
):
    """Import a single sample into the library.

    Args:
        path: Path to the audio file.
        tags: Optional list of tags to apply.
        source_type: Source type (imported, recorded, generated).
        sample_type: Type of sample (kick, snare, etc.).
        analyze: Whether to run analysis on the sample.

    Returns:
        Sample dict if successful.

    Raises:
        ValueError: If sample already exists.
        RuntimeError: If import fails.
    """
    from pathlib import Path as PathLib

    if not NATIVE_AVAILABLE:
        raise RuntimeError("Native backend not available")

    path = PathLib(path)
    path_str = str(path.absolute())

    # Check if already exists
    existing = get_sample_by_path(path_str)
    if existing:
        raise ValueError(f"Sample already exists: {path_str}")

    # Get audio info
    duration = None
    sample_rate = None
    channels = None
    try:
        import soundfile as sf
        info = sf.info(path_str)
        duration = info.duration
        sample_rate = info.samplerate
        channels = info.channels
    except Exception:
        pass

    # Insert sample
    sample_id = _insert_sample(
        path=path_str,
        source_type=source_type,
        sample_type=sample_type,
        duration=duration,
        sample_rate=sample_rate,
        channels=channels,
    )

    # Add tags
    if tags:
        for tag in tags:
            add_tag_to_sample(sample_id, tag)

    # Run analysis if requested
    if analyze:
        try:
            from sample_analysis import get_analyzer

            analyzers = {}
            for name in ["bpm", "key", "quality", "spectral"]:
                try:
                    analyzers[name] = get_analyzer(name)
                except Exception:
                    pass

            analysis_data = {}
            for name, analyzer in analyzers.items():
                try:
                    result = analyzer.analyze(path_str)
                    if name == "bpm":
                        analysis_data["bpm"] = result.bpm
                    elif name == "key":
                        analysis_data["key"] = result.key
                    elif name == "quality":
                        analysis_data["rms_db"] = result.rms_db
                        analysis_data["peak_db"] = result.peak_db
                        analysis_data["crest_factor"] = result.crest_factor
                        analysis_data["dynamic_range"] = result.dynamic_range
                        analysis_data["clipping_detected"] = result.clipping_detected
                    elif name == "spectral":
                        analysis_data["spectral_centroid"] = result.spectral_centroid
                        analysis_data["spectral_flatness"] = result.spectral_flatness
                except Exception:
                    pass

            if analysis_data:
                update_sample_analysis(sample_id, **analysis_data)
        except ImportError:
            pass

    return get_sample(sample_id)


def add_tags(path_or_id, tags: list[str]):
    """Add tags to a sample.

    Args:
        path_or_id: Sample path or ID.
        tags: List of tag names to add.
    """
    if not NATIVE_AVAILABLE:
        raise RuntimeError("Native backend not available")

    # Resolve sample ID
    if isinstance(path_or_id, int):
        sample_id = path_or_id
    else:
        sample = get_sample_by_path(str(path_or_id))
        if not sample:
            raise ValueError(f"Sample not found: {path_or_id}")
        sample_id = sample["id"]

    for tag in tags:
        add_tag_to_sample(sample_id, tag)

# Lazy imports for Python modules
_lazy_imports = {
    "BatchImporter": "sample_library.batch_import",
    "ImportOptions": "sample_library.batch_import",
    "ImportProgress": "sample_library.batch_import",
    "ImportPhase": "sample_library.batch_import",
    "batch_import": "sample_library.batch_import",
    "Sample": "sample_library.models",
    "Pack": "sample_library.models",
    "Tag": "sample_library.models",
    "ScoreComponents": "sample_library.scoring",
    "score_sample": "sample_library.scoring",
    "compute_applicability_score": "sample_library.scoring",
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
    native_exports = []
    if NATIVE_AVAILABLE:
        native_exports = [
            "init_db", "get_sample", "get_sample_by_path", "get_samples",
            "get_samples_by_ids", "count_samples", "get_packs", "get_tags",
            "get_sample_tags", "add_tag_to_sample", "remove_tag_from_sample",
            "store_embedding", "get_embedding", "extract_embedding",
            "get_samples_without_embeddings", "generate_embeddings",
            "search_similar", "find_compatible", "categorize",
            "compute_score", "score_sample_native",
        ]
    return list(_lazy_imports.keys()) + native_exports + ["__version__", "NATIVE_AVAILABLE"]


__all__ = [
    "__version__",
    "NATIVE_AVAILABLE",
    # Native functions (if available)
    "init_db",
    "get_sample",
    "get_sample_by_path",
    "get_samples",
    "get_samples_by_ids",
    "count_samples",
    "get_packs",
    "get_tags",
    "get_sample_tags",
    "add_tag_to_sample",
    "remove_tag_from_sample",
    "update_sample_analysis",
    "get_or_create_pack",
    "store_embedding",
    "get_embedding",
    "extract_embedding",
    "get_samples_without_embeddings",
    "generate_embeddings",
    "search_similar",
    "find_compatible",
    "categorize",
    "compute_score",
    # High-level Python functions
    "import_sample",
    "add_tags",
    # Python classes
    "BatchImporter",
    "ImportOptions",
    "ImportProgress",
    "ImportPhase",
    "batch_import",
    "Sample",
    "Pack",
    "Tag",
    "ScoreComponents",
    "score_sample",
    "compute_applicability_score",
]
