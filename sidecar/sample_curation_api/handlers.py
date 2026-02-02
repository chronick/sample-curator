"""JSON-RPC method handlers."""

import hashlib
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from sample_library.db import get_session
from sample_library.models import Pack, Sample, Tag
from sample_library.batch_import import BatchImporter, ImportOptions, ImportProgress

# Active import jobs
_import_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def search(
    query: str | None = None,
    tags: list[str] | None = None,
    pack_id: int | None = None,
    min_score: float | None = None,
    max_score: float | None = None,
    sample_type: str | None = None,
    min_bpm: float | None = None,
    max_bpm: float | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Search for samples."""
    session = get_session()

    try:
        stmt = select(Sample).options(selectinload(Sample.tags), selectinload(Sample.pack))

        # Apply filters
        if query:
            stmt = stmt.where(Sample.path.ilike(f"%{query}%"))

        if tags:
            for tag_name in tags:
                tag_subquery = (
                    select(Sample.id).join(Sample.tags).where(Tag.name == tag_name)
                )
                stmt = stmt.where(Sample.id.in_(tag_subquery))

        if pack_id:
            stmt = stmt.where(Sample.pack_id == pack_id)

        if min_score is not None:
            stmt = stmt.where(Sample.applicability_score >= min_score)

        if max_score is not None:
            stmt = stmt.where(Sample.applicability_score <= max_score)

        if sample_type:
            stmt = stmt.where(Sample.sample_type == sample_type)

        if min_bpm is not None:
            stmt = stmt.where(Sample.bpm >= min_bpm)

        if max_bpm is not None:
            stmt = stmt.where(Sample.bpm <= max_bpm)

        # Count total
        from sqlalchemy import func

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        # Apply pagination and ordering
        stmt = stmt.order_by(Sample.applicability_score.desc().nulls_last())
        stmt = stmt.offset(offset).limit(limit)

        samples = session.execute(stmt).scalars().all()

        return {
            "samples": [_sample_to_dict(s) for s in samples],
            "total": total,
        }

    finally:
        session.close()


def get_sample(id: int) -> dict:
    """Get a sample by ID."""
    session = get_session()

    try:
        stmt = (
            select(Sample)
            .options(selectinload(Sample.tags), selectinload(Sample.pack))
            .where(Sample.id == id)
        )
        sample = session.execute(stmt).scalar_one_or_none()

        if not sample:
            raise ValueError(f"Sample not found: {id}")

        return _sample_to_dict(sample)

    finally:
        session.close()


def update_sample(id: int, updates: dict) -> dict:
    """Update a sample."""
    session = get_session()

    try:
        stmt = (
            select(Sample)
            .options(selectinload(Sample.tags), selectinload(Sample.pack))
            .where(Sample.id == id)
        )
        sample = session.execute(stmt).scalar_one_or_none()

        if not sample:
            raise ValueError(f"Sample not found: {id}")

        # Apply updates
        for key, value in updates.items():
            if hasattr(sample, key) and key not in ("id", "path", "tags"):
                setattr(sample, key, value)

        session.commit()
        session.refresh(sample)

        return _sample_to_dict(sample)

    finally:
        session.close()


def delete_sample(id: int) -> bool:
    """Delete a sample."""
    session = get_session()

    try:
        sample = session.get(Sample, id)
        if not sample:
            return False

        session.delete(sample)
        session.commit()
        return True

    finally:
        session.close()


def start_import(path: str, options: dict) -> str:
    """Start an import job."""
    job_id = str(uuid.uuid4())

    import_options = ImportOptions(
        recursive=options.get("recursive", True),
        exclude_patterns=options.get("exclude_patterns", []),
        analyze=options.get("analyze", True),
        compute_scores=options.get("analyze", True),
        detect_duplicates=options.get("detect_duplicates", True),
    )

    progress_state = {
        "phase": "scanning",
        "current": 0,
        "total": 0,
        "current_file": "",
        "errors": [],
        "duplicates_skipped": 0,
        "imported_count": 0,
    }

    def progress_callback(progress: ImportProgress):
        progress_state["phase"] = progress.phase.value
        progress_state["current"] = progress.current
        progress_state["total"] = progress.total
        progress_state["current_file"] = progress.current_file
        progress_state["errors"] = progress.errors
        progress_state["duplicates_skipped"] = progress.duplicates_skipped
        progress_state["imported_count"] = progress.imported_count

    with _jobs_lock:
        _import_jobs[job_id] = {
            "progress": progress_state,
            "importer": None,
            "thread": None,
        }

    def run_import():
        importer = BatchImporter(progress_callback=progress_callback)
        with _jobs_lock:
            _import_jobs[job_id]["importer"] = importer

        try:
            importer.run(Path(path), import_options)
        except Exception as e:
            progress_state["phase"] = "error"
            progress_state["errors"].append(("pipeline", str(e)))

    thread = threading.Thread(target=run_import, daemon=True)
    thread.start()

    with _jobs_lock:
        _import_jobs[job_id]["thread"] = thread

    return job_id


def get_import_progress(job_id: str) -> dict:
    """Get import progress."""
    with _jobs_lock:
        job = _import_jobs.get(job_id)
        if not job:
            raise ValueError(f"Job not found: {job_id}")
        return job["progress"].copy()


def cancel_import(job_id: str) -> bool:
    """Cancel an import job."""
    with _jobs_lock:
        job = _import_jobs.get(job_id)
        if not job:
            return False

        importer = job.get("importer")
        if importer:
            importer.cancel()

        return True


def get_waveform(id: int, width: int = 800) -> dict:
    """Get waveform peaks for a sample."""
    session = get_session()

    try:
        sample = session.get(Sample, id)
        if not sample:
            raise ValueError(f"Sample not found: {id}")

        filepath = Path(sample.path)
        if not filepath.exists():
            raise ValueError(f"File not found: {filepath}")

        # Load audio and compute peaks
        try:
            import soundfile as sf

            data, sr = sf.read(str(filepath))

            # Convert to mono if stereo
            if len(data.shape) > 1:
                data = data.mean(axis=1)

            # Compute peaks for visualization
            samples_per_pixel = len(data) // width
            if samples_per_pixel < 1:
                samples_per_pixel = 1

            peaks = []
            for i in range(width):
                start = i * samples_per_pixel
                end = start + samples_per_pixel
                chunk = data[start:end]
                if len(chunk) > 0:
                    peak = float(np.max(np.abs(chunk)))
                    peaks.append(peak)
                else:
                    peaks.append(0.0)

            return {
                "peaks": peaks,
                "duration": sample.duration or len(data) / sr,
            }

        except Exception as e:
            raise ValueError(f"Failed to load audio: {e}")

    finally:
        session.close()


def list_packs() -> list[dict]:
    """List all packs."""
    session = get_session()

    try:
        stmt = select(Pack).order_by(Pack.created_at.desc())
        packs = session.execute(stmt).scalars().all()

        return [
            {
                "id": p.id,
                "name": p.name,
                "path": p.path,
                "source_type": p.source_type,
                "vendor": p.vendor,
                "sample_count": p.sample_count,
                "avg_quality_score": p.avg_quality_score,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in packs
        ]

    finally:
        session.close()


def analyze_sample(id: int) -> dict:
    """Analyze a sample."""
    from sample_library.analysis import analyze_and_update

    session = get_session()

    try:
        sample = session.get(Sample, id)
        if not sample:
            raise ValueError(f"Sample not found: {id}")

        analyze_and_update(sample, session=session)

        return {
            "bpm": sample.bpm,
            "key": sample.key,
            "quality_score": sample.quality_score,
            "applicability_score": sample.applicability_score,
        }

    finally:
        session.close()


def list_tags() -> list[str]:
    """List all tags."""
    session = get_session()

    try:
        stmt = select(Tag.name).order_by(Tag.name)
        tags = session.execute(stmt).scalars().all()
        return list(tags)

    finally:
        session.close()


def add_tags(id: int, tags: list[str]) -> dict:
    """Add tags to a sample."""
    session = get_session()

    try:
        stmt = (
            select(Sample)
            .options(selectinload(Sample.tags), selectinload(Sample.pack))
            .where(Sample.id == id)
        )
        sample = session.execute(stmt).scalar_one_or_none()

        if not sample:
            raise ValueError(f"Sample not found: {id}")

        existing_tags = {t.name for t in sample.tags}

        for tag_name in tags:
            if tag_name not in existing_tags:
                tag = session.execute(
                    select(Tag).where(Tag.name == tag_name)
                ).scalar_one_or_none()

                if not tag:
                    tag = Tag(name=tag_name)
                    session.add(tag)

                sample.tags.append(tag)

        session.commit()
        session.refresh(sample)

        return _sample_to_dict(sample)

    finally:
        session.close()


def remove_tags(id: int, tags: list[str]) -> dict:
    """Remove tags from a sample."""
    session = get_session()

    try:
        stmt = (
            select(Sample)
            .options(selectinload(Sample.tags), selectinload(Sample.pack))
            .where(Sample.id == id)
        )
        sample = session.execute(stmt).scalar_one_or_none()

        if not sample:
            raise ValueError(f"Sample not found: {id}")

        tags_to_remove = set(tags)
        sample.tags = [t for t in sample.tags if t.name not in tags_to_remove]

        session.commit()
        session.refresh(sample)

        return _sample_to_dict(sample)

    finally:
        session.close()


def batch_update(ids: list[int], updates: dict) -> int:
    """Batch update samples."""
    session = get_session()
    count = 0

    try:
        for sample_id in ids:
            sample = session.get(Sample, sample_id)
            if sample:
                for key, value in updates.items():
                    if hasattr(sample, key) and key not in ("id", "path", "tags"):
                        setattr(sample, key, value)
                count += 1

        session.commit()
        return count

    finally:
        session.close()


def batch_delete(ids: list[int]) -> int:
    """Batch delete samples."""
    session = get_session()
    count = 0

    try:
        for sample_id in ids:
            sample = session.get(Sample, sample_id)
            if sample:
                session.delete(sample)
                count += 1

        session.commit()
        return count

    finally:
        session.close()


def batch_add_tags(ids: list[int], tags: list[str]) -> int:
    """Batch add tags to samples."""
    session = get_session()
    count = 0

    try:
        # Get or create tags
        tag_objs = []
        for tag_name in tags:
            tag = session.execute(
                select(Tag).where(Tag.name == tag_name)
            ).scalar_one_or_none()

            if not tag:
                tag = Tag(name=tag_name)
                session.add(tag)
                session.flush()

            tag_objs.append(tag)

        # Add tags to samples
        for sample_id in ids:
            stmt = (
                select(Sample)
                .options(selectinload(Sample.tags))
                .where(Sample.id == sample_id)
            )
            sample = session.execute(stmt).scalar_one_or_none()

            if sample:
                existing = {t.name for t in sample.tags}
                for tag in tag_objs:
                    if tag.name not in existing:
                        sample.tags.append(tag)
                count += 1

        session.commit()
        return count

    finally:
        session.close()


def get_spectrogram(id: int, width: int = 800, height: int = 128) -> dict:
    """Get spectrogram data for a sample.

    Returns a 2D array of normalized values (0-1) representing the mel spectrogram.
    Rows are frequency bins (low to high), columns are time frames.
    """
    from sample_analysis import get_analyzer

    session = get_session()

    try:
        sample = session.get(Sample, id)
        if not sample:
            raise ValueError(f"Sample not found: {id}")

        filepath = Path(sample.path)
        if not filepath.exists():
            raise ValueError(f"File not found: {filepath}")

        try:
            analyzer = get_analyzer("spectrogram")
            result = analyzer.analyze(filepath, width=width, height=height)

            return {
                "spectrogram": result.spectrogram,
                "duration": result.duration,
                "width": result.width,
                "height": result.height,
            }

        except Exception as e:
            raise ValueError(f"Failed to compute spectrogram: {e}")

    finally:
        session.close()


def _sample_to_dict(sample: Sample) -> dict:
    """Convert Sample to dict."""
    return {
        "id": sample.id,
        "path": sample.path,
        "source_type": sample.source_type,
        "sample_type": sample.sample_type,
        "bpm": sample.bpm,
        "key": sample.key,
        "duration": sample.duration,
        "sample_rate": sample.sample_rate,
        "channels": sample.channels,
        "tags": [t.name for t in sample.tags],
        "rms_db": sample.rms_db,
        "peak_db": sample.peak_db,
        "crest_factor": sample.crest_factor,
        "dynamic_range": sample.dynamic_range,
        "clipping_detected": sample.clipping_detected,
        "spectral_centroid": sample.spectral_centroid,
        "spectral_flatness": sample.spectral_flatness,
        "loop_quality": sample.loop_quality,
        "is_loopable": sample.is_loopable,
        "quality_score": sample.quality_score,
        "applicability_score": sample.applicability_score,
        "pack_id": sample.pack_id,
        "pack_name": sample.pack.name if sample.pack else None,
        "created_at": sample.created_at.isoformat() if sample.created_at else None,
        "updated_at": sample.updated_at.isoformat() if sample.updated_at else None,
        "analyzed_at": sample.analyzed_at.isoformat() if sample.analyzed_at else None,
    }


# Handler registry
HANDLERS = {
    "search": search,
    "get_sample": get_sample,
    "update_sample": update_sample,
    "delete_sample": delete_sample,
    "start_import": start_import,
    "get_import_progress": get_import_progress,
    "cancel_import": cancel_import,
    "get_waveform": get_waveform,
    "get_spectrogram": get_spectrogram,
    "list_packs": list_packs,
    "analyze_sample": analyze_sample,
    "list_tags": list_tags,
    "add_tags": add_tags,
    "remove_tags": remove_tags,
    "batch_update": batch_update,
    "batch_delete": batch_delete,
    "batch_add_tags": batch_add_tags,
}
