"""Batch import pipeline for sample curation.

Handles:
- Recursive directory scanning
- Format filtering (wav, aif, flac, mp3, ogg)
- Audio fingerprinting for duplicate detection
- Pack inference from folder structure
- Parallel analysis execution
- Progress callbacks

This module works with both the native Rust backend and pure Python.
"""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from fnmatch import fnmatch
from pathlib import Path
from typing import Callable, Optional, Any

from sample_library.scoring import score_sample, ScoreComponents

# Try native backend
try:
    import sample_library_native as native
    NATIVE_AVAILABLE = True
except ImportError:
    NATIVE_AVAILABLE = False


# Supported audio formats
AUDIO_EXTENSIONS = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a"}


class ImportPhase(Enum):
    """Import pipeline phases."""
    SCANNING = "scanning"
    FINGERPRINTING = "fingerprinting"
    ANALYZING = "analyzing"
    IMPORTING = "importing"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass
class ImportProgress:
    """Progress state for batch import."""
    phase: ImportPhase
    current: int = 0
    total: int = 0
    current_file: str = ""
    errors: list[tuple[str, str]] = field(default_factory=list)
    duplicates_skipped: int = 0
    imported_count: int = 0

    @property
    def percentage(self) -> float:
        if self.total == 0:
            return 0.0
        return (self.current / self.total) * 100


@dataclass
class ImportOptions:
    """Options for batch import."""
    recursive: bool = True
    exclude_patterns: list[str] = field(default_factory=list)
    analyze: bool = True
    compute_scores: bool = True
    detect_duplicates: bool = True
    auto_tag: bool = True
    workers: int = 4
    pack_name: Optional[str] = None
    source_type: str = "imported"


@dataclass
class ScanResult:
    """Result of directory scan."""
    files: list[Path]
    detected_pack_name: str
    detected_source_type: str


class BatchImporter:
    """Batch import pipeline for sample collections."""

    def __init__(
        self,
        progress_callback: Callable[[ImportProgress], None] | None = None,
    ):
        """Initialize batch importer.

        Args:
            progress_callback: Callback for progress updates.
        """
        self._progress_callback = progress_callback
        self._progress = ImportProgress(phase=ImportPhase.SCANNING)
        self._cancelled = False

    def _update_progress(self, **kwargs):
        """Update progress and notify callback."""
        for key, value in kwargs.items():
            setattr(self._progress, key, value)
        if self._progress_callback:
            self._progress_callback(self._progress)

    def cancel(self):
        """Request cancellation of the import."""
        self._cancelled = True

    def scan_directory(
        self,
        directory: Path | str,
        options: ImportOptions,
    ) -> ScanResult:
        """Scan directory for audio files.

        Args:
            directory: Root directory to scan.
            options: Import options.

        Returns:
            ScanResult with list of files and detected metadata.
        """
        directory = Path(directory).resolve()
        if not directory.is_dir():
            raise ValueError(f"Not a directory: {directory}")

        self._update_progress(phase=ImportPhase.SCANNING, current=0, total=0)

        files: list[Path] = []

        def should_exclude(path: Path) -> bool:
            """Check if path matches any exclude pattern."""
            for pattern in options.exclude_patterns:
                if fnmatch(str(path), pattern) or fnmatch(path.name, pattern):
                    return True
            return False

        if options.recursive:
            for root, dirs, filenames in os.walk(directory):
                if self._cancelled:
                    break

                # Skip hidden directories and common non-sample folders
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".")
                    and d.lower() not in ("__macosx", "backup", "trash")
                    and not should_exclude(Path(root) / d)
                ]

                for filename in filenames:
                    if self._cancelled:
                        break
                    filepath = Path(root) / filename
                    if (
                        filepath.suffix.lower() in AUDIO_EXTENSIONS
                        and not filename.startswith(".")
                        and not should_exclude(filepath)
                    ):
                        files.append(filepath)
                        self._update_progress(
                            current=len(files),
                            current_file=str(filepath.relative_to(directory)),
                        )
        else:
            for filepath in directory.iterdir():
                if self._cancelled:
                    break
                if (
                    filepath.is_file()
                    and filepath.suffix.lower() in AUDIO_EXTENSIONS
                    and not filepath.name.startswith(".")
                    and not should_exclude(filepath)
                ):
                    files.append(filepath)
                    self._update_progress(current=len(files))

        # Detect pack metadata
        detected_pack_name = options.pack_name or self._detect_pack_name(directory)
        detected_source_type = self._detect_source_type(directory, files)

        self._update_progress(total=len(files))

        return ScanResult(
            files=files,
            detected_pack_name=detected_pack_name,
            detected_source_type=detected_source_type,
        )

    def _detect_pack_name(self, directory: Path) -> str:
        """Detect pack name from directory structure."""
        return directory.name

    def _detect_source_type(self, directory: Path, files: list[Path]) -> str:
        """Detect source type from directory contents."""
        dir_str = str(directory).lower()

        # Check for Ableton project indicators
        if any(f.suffix.lower() == ".als" for f in directory.rglob("*.als")):
            return "ableton_project"

        # Check for Splice indicators
        if "splice" in dir_str:
            return "splice"

        # Check for common vendor patterns
        vendors = [
            "native instruments", "ni", "kontakt",
            "loopmasters", "splice", "output",
            "arturia", "xfer", "cymatics",
        ]
        for vendor in vendors:
            if vendor in dir_str:
                return "vendor"

        return "folder"

    def fingerprint_files(
        self,
        files: list[Path],
        options: ImportOptions,
    ) -> dict[Path, tuple[str, str]]:
        """Generate fingerprints for files.

        Args:
            files: List of audio files.
            options: Import options.

        Returns:
            Dict mapping path to (fingerprint, fingerprint_hash) tuples.
        """
        if not options.detect_duplicates:
            return {}

        self._update_progress(
            phase=ImportPhase.FINGERPRINTING,
            current=0,
            total=len(files),
        )

        fingerprints: dict[Path, tuple[str, str]] = {}

        try:
            from sample_analysis import get_analyzer
            fp_analyzer = get_analyzer("fingerprint")
        except (ImportError, Exception):
            # Fingerprinting not available
            return {}

        def process_file(filepath: Path) -> tuple[Path, str | None, str | None]:
            try:
                result = fp_analyzer.analyze(filepath)
                fp = result.fingerprint
                fp_hash = hashlib.sha256(fp.encode()).hexdigest()[:32]
                return (filepath, fp, fp_hash)
            except Exception:
                return (filepath, None, None)

        with ThreadPoolExecutor(max_workers=options.workers) as executor:
            futures = {
                executor.submit(process_file, f): f for f in files
            }

            for i, future in enumerate(as_completed(futures)):
                if self._cancelled:
                    executor.shutdown(wait=False, cancel_futures=True)
                    break

                filepath, fp, fp_hash = future.result()
                if fp and fp_hash:
                    fingerprints[filepath] = (fp, fp_hash)

                self._update_progress(
                    current=i + 1,
                    current_file=filepath.name,
                )

        return fingerprints

    def analyze_files(
        self,
        files: list[Path],
        options: ImportOptions,
    ) -> dict[Path, dict]:
        """Run analysis on files.

        Args:
            files: List of audio files.
            options: Import options.

        Returns:
            Dict mapping paths to analysis results.
        """
        if not options.analyze:
            return {}

        self._update_progress(
            phase=ImportPhase.ANALYZING,
            current=0,
            total=len(files),
        )

        results: dict[Path, dict] = {}

        # Get available analyzers
        analyzers = {}
        try:
            from sample_analysis import get_analyzer

            for name in ["quality", "spectral", "loop", "bpm", "key"]:
                try:
                    analyzers[name] = get_analyzer(name)
                except Exception:
                    pass
        except ImportError:
            return {}

        def process_file(filepath: Path) -> tuple[Path, dict]:
            analysis = {}

            # Get basic audio info
            try:
                import soundfile as sf
                info = sf.info(str(filepath))
                analysis["duration"] = info.duration
                analysis["sample_rate"] = info.samplerate
                analysis["channels"] = info.channels
            except Exception:
                pass

            # Run analyzers
            for name, analyzer in analyzers.items():
                try:
                    result = analyzer.analyze(filepath)
                    if name == "quality":
                        analysis["rms_db"] = result.rms_db
                        analysis["peak_db"] = result.peak_db
                        analysis["crest_factor"] = result.crest_factor
                        analysis["dynamic_range"] = result.dynamic_range
                        analysis["clipping_detected"] = result.clipping_detected
                    elif name == "spectral":
                        analysis["spectral_centroid"] = result.spectral_centroid
                        analysis["spectral_flatness"] = result.spectral_flatness
                    elif name == "loop":
                        analysis["loop_quality"] = result.quality_score
                        analysis["is_loopable"] = result.is_loopable
                    elif name == "bpm":
                        analysis["bpm"] = result.bpm
                    elif name == "key":
                        analysis["key"] = result.key
                except Exception:
                    pass

            return (filepath, analysis)

        with ThreadPoolExecutor(max_workers=options.workers) as executor:
            futures = {
                executor.submit(process_file, f): f for f in files
            }

            for i, future in enumerate(as_completed(futures)):
                if self._cancelled:
                    executor.shutdown(wait=False, cancel_futures=True)
                    break

                filepath, analysis = future.result()
                results[filepath] = analysis

                self._update_progress(
                    current=i + 1,
                    current_file=filepath.name,
                )

        return results

    def _auto_tag_sample(self, filepath: Path, analysis: dict) -> list[str]:
        """Generate automatic tags based on path and analysis.

        Args:
            filepath: File path for inference.
            analysis: Analysis results.

        Returns:
            List of tag names.
        """
        tags_to_add = []

        # Infer from path
        path_lower = str(filepath).lower()

        # Instrument type hints
        type_hints = {
            "kick": ["kick", "bd", "bassdrum"],
            "snare": ["snare", "sd"],
            "hihat": ["hihat", "hat", "hh"],
            "clap": ["clap", "cp"],
            "percussion": ["perc", "percussion", "tom", "conga", "bongo"],
            "bass": ["bass", "sub"],
            "synth": ["synth", "lead", "pad"],
            "fx": ["fx", "effect", "riser", "impact", "sweep"],
            "vocal": ["vocal", "vox", "voice"],
            "loop": ["loop", "loops"],
        }

        detected_type = None
        for tag, patterns in type_hints.items():
            if any(p in path_lower for p in patterns):
                tags_to_add.append(tag)
                detected_type = tag
                break

        # Genre hints
        genre_hints = {
            "techno": ["techno"],
            "house": ["house"],
            "dnb": ["dnb", "drum and bass", "drum n bass"],
            "idm": ["idm"],
            "ambient": ["ambient", "atmospheric"],
        }

        for tag, patterns in genre_hints.items():
            if any(p in path_lower for p in patterns):
                tags_to_add.append(tag)
                break

        # Quality hints based on score
        if "applicability_score" in analysis:
            score = analysis["applicability_score"]
            if score >= 80:
                tags_to_add.append("high-quality")
            elif score < 40:
                tags_to_add.append("low-quality")

        return tags_to_add, detected_type

    def run(
        self,
        directory: Path | str,
        options: ImportOptions | None = None,
    ) -> ImportProgress:
        """Run full import pipeline.

        Note: This method performs scanning, fingerprinting, and analysis.
        The actual database import should be done by the caller using the
        returned data.

        Args:
            directory: Directory to import.
            options: Import options.

        Returns:
            Final import progress with results.
        """
        if options is None:
            options = ImportOptions()

        directory = Path(directory).resolve()

        try:
            # Phase 1: Scan
            scan = self.scan_directory(directory, options)
            if self._cancelled or not scan.files:
                self._update_progress(phase=ImportPhase.COMPLETE)
                return self._progress

            # Phase 2: Fingerprint
            fingerprints = self.fingerprint_files(scan.files, options)
            if self._cancelled:
                self._update_progress(phase=ImportPhase.COMPLETE)
                return self._progress

            # Phase 3: Analyze
            analyses = self.analyze_files(scan.files, options)
            if self._cancelled:
                self._update_progress(phase=ImportPhase.COMPLETE)
                return self._progress

            # Compute scores
            if options.compute_scores:
                for filepath, analysis in analyses.items():
                    # Create a simple object for scoring
                    class _SampleData:
                        pass
                    sample_data = _SampleData()
                    for k, v in analysis.items():
                        setattr(sample_data, k, v)

                    scores = score_sample(sample_data)
                    analysis["quality_score"] = scores.quality
                    analysis["applicability_score"] = scores.total

            # Auto-tag
            if options.auto_tag:
                for filepath, analysis in analyses.items():
                    tags, sample_type = self._auto_tag_sample(filepath, analysis)
                    analysis["auto_tags"] = tags
                    if sample_type:
                        analysis["sample_type"] = sample_type

            # Store results in progress for caller to use
            self._progress.scan_result = scan
            self._progress.fingerprints = fingerprints
            self._progress.analyses = analyses

            self._update_progress(phase=ImportPhase.COMPLETE)

        except Exception as e:
            self._update_progress(phase=ImportPhase.ERROR)
            self._progress.errors.append(("pipeline", str(e)))
            raise

        return self._progress


def batch_import(
    directory: Path | str,
    recursive: bool = True,
    exclude_patterns: list[str] | None = None,
    analyze: bool = True,
    compute_scores: bool = True,
    detect_duplicates: bool = True,
    workers: int = 4,
    progress_callback: Callable[[ImportProgress], None] | None = None,
) -> ImportProgress:
    """Convenience function for batch import.

    Args:
        directory: Directory to import.
        recursive: Scan subdirectories.
        exclude_patterns: Glob patterns to exclude.
        analyze: Run audio analysis.
        compute_scores: Compute applicability scores.
        detect_duplicates: Check for duplicates.
        workers: Number of parallel workers.
        progress_callback: Progress callback function.

    Returns:
        Final import progress.
    """
    options = ImportOptions(
        recursive=recursive,
        exclude_patterns=exclude_patterns or [],
        analyze=analyze,
        compute_scores=compute_scores,
        detect_duplicates=detect_duplicates,
        workers=workers,
    )

    importer = BatchImporter(progress_callback=progress_callback)
    return importer.run(directory, options)
