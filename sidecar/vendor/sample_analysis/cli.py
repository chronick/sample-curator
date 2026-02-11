"""Command-line interface for sample-analysis."""

import json
from pathlib import Path
from typing import Optional

import typer
from rich import print as rprint
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="Audio analysis toolkit for electronic music")
console = Console()

# Analyzers subcommand group
analyzers_app = typer.Typer(help="Manage analyzers")
app.add_typer(analyzers_app, name="analyzers")

# Segment subcommand group
segment_app = typer.Typer(help="Audio segmentation tools")
app.add_typer(segment_app, name="segment")


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYSIS COMMANDS
# ═══════════════════════════════════════════════════════════════════════════════


@app.command()
def bpm(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    include_beats: bool = typer.Option(False, "--beats", "-b", help="Include beat positions"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Detect BPM and optionally beat positions.

    Examples:
        sample-analysis bpm kick.wav
        sample-analysis bpm loop.wav --beats
        sample-analysis bpm track.wav --json
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("bpm")
        result = analyzer.analyze(audio_path, include_beats=include_beats)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]BPM:[/cyan] {result.bpm}")
            rprint(f"[cyan]Confidence:[/cyan] {result.confidence:.2%}")
            if result.beat_times:
                rprint(f"[cyan]Beats:[/cyan] {len(result.beat_times)} detected")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def key(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    include_chroma: bool = typer.Option(False, "--chroma", "-c", help="Include chroma profile"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Detect musical key.

    Examples:
        sample-analysis key track.wav
        sample-analysis key melody.wav --json
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("key")
        result = analyzer.analyze(audio_path, include_chroma=include_chroma)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]Key:[/cyan] {result.key} {result.mode}")
            rprint(f"[cyan]Confidence:[/cyan] {result.confidence:.2%}")
            if result.alternate_keys:
                alts = ", ".join(f"{k} ({c:.0%})" for k, c in result.alternate_keys)
                rprint(f"[cyan]Alternates:[/cyan] {alts}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def quality(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Analyze audio quality metrics (RMS, peak, crest factor, etc.).

    Examples:
        sample-analysis quality sample.wav
        sample-analysis quality master.wav --json
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("quality")
        result = analyzer.analyze(audio_path)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]RMS Level:[/cyan] {result.rms_db:.1f} dB")
            rprint(f"[cyan]Peak Level:[/cyan] {result.peak_db:.1f} dB")
            rprint(f"[cyan]Crest Factor:[/cyan] {result.crest_factor:.1f} dB")
            rprint(f"[cyan]Dynamic Range:[/cyan] {result.dynamic_range:.1f} dB")
            if result.clipping_detected:
                rprint(f"[yellow]Clipping:[/yellow] Detected ({result.clipping_ratio:.2%})")
            else:
                rprint(f"[green]Clipping:[/green] None detected")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def spectral(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    include_mfcc: bool = typer.Option(True, "--mfcc/--no-mfcc", help="Include MFCCs"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Analyze spectral features (centroid, rolloff, bandwidth, etc.).

    Examples:
        sample-analysis spectral sample.wav
        sample-analysis spectral synth.wav --no-mfcc
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("spectral")
        result = analyzer.analyze(audio_path, include_mfcc=include_mfcc)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]Spectral Centroid:[/cyan] {result.spectral_centroid:.0f} Hz")
            rprint(f"[cyan]Spectral Rolloff:[/cyan] {result.spectral_rolloff:.0f} Hz")
            rprint(f"[cyan]Spectral Bandwidth:[/cyan] {result.spectral_bandwidth:.0f} Hz")
            rprint(f"[cyan]Spectral Flatness:[/cyan] {result.spectral_flatness:.4f}")
            rprint(f"[cyan]Zero Crossing Rate:[/cyan] {result.zero_crossing_rate:.4f}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def transients(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    include_strengths: bool = typer.Option(False, "--strengths", "-s", help="Include onset strengths"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Detect transients/onsets in audio.

    Examples:
        sample-analysis transients drums.wav
        sample-analysis transients percussion.wav --strengths
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("transient")
        result = analyzer.analyze(audio_path, include_strengths=include_strengths)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]Onsets Detected:[/cyan] {result.num_onsets}")
            if result.onset_times and len(result.onset_times) <= 10:
                times = ", ".join(f"{t:.3f}s" for t in result.onset_times)
                rprint(f"[cyan]Onset Times:[/cyan] {times}")
            elif result.onset_times:
                first_few = ", ".join(f"{t:.3f}s" for t in result.onset_times[:5])
                rprint(f"[cyan]First 5 Onsets:[/cyan] {first_few}...")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("loop")
def loop_analysis(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Analyze loop quality and find optimal loop points.

    Examples:
        sample-analysis loop pad.wav
        sample-analysis loop texture.wav --json
    """
    from sample_analysis.analyzers import get_analyzer

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        analyzer = get_analyzer("loop")
        result = analyzer.analyze(audio_path)

        if json_output:
            rprint(result.model_dump_json(indent=2))
        else:
            status = "[green]Yes[/green]" if result.is_loopable else "[yellow]No[/yellow]"
            rprint(f"[cyan]Loopable:[/cyan] {status}")
            rprint(f"[cyan]Quality Score:[/cyan] {result.quality_score:.2%}")
            rprint(f"[cyan]Spectral Continuity:[/cyan] {result.spectral_continuity:.2%}")
            rprint(f"[cyan]Amplitude Continuity:[/cyan] {result.amplitude_continuity:.2%}")
            rprint(f"[cyan]Zero-Crossing Aligned:[/cyan] {'Yes' if result.zero_crossing_aligned else 'No'}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def analyze(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output JSON file"),
    analyzers: Optional[str] = typer.Option(
        None,
        "--analyzers",
        "-a",
        help="Comma-separated list of analyzers (default: all available)",
    ),
):
    """Run full analysis pipeline on audio file.

    Examples:
        sample-analysis analyze track.wav
        sample-analysis analyze sample.wav --output analysis.json
        sample-analysis analyze loop.wav --analyzers bpm,key,quality
    """
    from sample_analysis.analyzers import get_analyzer, list_analyzers
    from sample_analysis.models import AudioInfo, FullAnalysis
    from sample_analysis.analyzers._rust_bridge import get_audio_info

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    # Get audio info
    audio_info = get_audio_info(audio_path)

    # Determine which analyzers to run
    if analyzers:
        analyzer_names = [a.strip() for a in analyzers.split(",")]
    else:
        # Use all available core analyzers
        analyzer_names = ["bpm", "key", "quality", "spectral", "transient", "loop"]

    rprint(f"[blue]Analyzing:[/blue] {audio_path}")

    results = {"info": audio_info}

    for name in analyzer_names:
        try:
            analyzer = get_analyzer(name)
            if not analyzer.is_available():
                rprint(f"  [dim]⊘ {name}[/dim] (not available)")
                continue

            rprint(f"  [blue]⟳ {name}[/blue]...", end="")
            result = analyzer.analyze(audio_path)
            results[name] = result
            rprint(f"\r  [green]✓ {name}[/green]    ")

        except Exception as e:
            rprint(f"\r  [red]✗ {name}[/red]: {e}")

    # Build FullAnalysis
    full_analysis = FullAnalysis(
        info=audio_info,
        bpm=results.get("bpm"),
        key=results.get("key"),
        spectral=results.get("spectral"),
        quality=results.get("quality"),
        transients=results.get("transient"),
        loop=results.get("loop"),
        embedding=results.get("embedding"),
        fingerprint=results.get("fingerprint"),
    )

    # Output
    if output:
        output.write_text(full_analysis.model_dump_json(indent=2))
        rprint(f"\n[green]Saved to:[/green] {output}")
    else:
        rprint("\n[bold]Results:[/bold]")
        rprint(full_analysis.model_dump_json(indent=2))


@app.command()
def info(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Output as JSON"),
):
    """Show basic audio file information.

    Examples:
        sample-analysis info sample.wav
        sample-analysis info track.mp3 --json
    """
    from sample_analysis.analyzers._rust_bridge import get_audio_info

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        audio_info = get_audio_info(audio_path)

        if json_output:
            rprint(audio_info.model_dump_json(indent=2))
        else:
            rprint(f"[cyan]File:[/cyan] {audio_path.name}")
            rprint(f"[cyan]Duration:[/cyan] {audio_info.duration_sec:.2f}s")
            rprint(f"[cyan]Sample Rate:[/cyan] {audio_info.sample_rate} Hz")
            rprint(f"[cyan]Channels:[/cyan] {audio_info.channels}")
            if audio_info.format:
                rprint(f"[cyan]Format:[/cyan] {audio_info.format}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


# ═══════════════════════════════════════════════════════════════════════════════
# SEGMENTATION COMMANDS
# ═══════════════════════════════════════════════════════════════════════════════


@segment_app.command("silence")
def segment_silence(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    threshold: float = typer.Option(-40.0, "--threshold", "-t", help="Silence threshold in dB"),
    min_silence: float = typer.Option(0.5, "--min-silence", help="Minimum silence duration (seconds)"),
    min_chunk: float = typer.Option(1.0, "--min-chunk", help="Minimum chunk duration (seconds)"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Export chunks to directory"),
):
    """Segment audio by silence detection.

    Examples:
        sample-analysis segment silence recording.wav
        sample-analysis segment silence vocals.wav --threshold -35 --output chunks/
    """
    from sample_analysis.segmentation import segment_by_silence

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        chunks = segment_by_silence(
            audio_path,
            silence_threshold_db=threshold,
            min_silence_duration=min_silence,
            min_chunk_duration=min_chunk,
            output_dir=output_dir,
            export=output_dir is not None,
        )

        rprint(f"[green]Found {len(chunks)} segments:[/green]")
        for i, chunk in enumerate(chunks):
            rprint(f"  {i + 1}. {chunk.start_time:.2f}s - {chunk.end_time:.2f}s ({chunk.duration:.2f}s)")
            if chunk.path:
                rprint(f"     [dim]→ {chunk.path}[/dim]")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@segment_app.command("beats")
def segment_beats(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    bars: int = typer.Option(8, "--bars", "-b", help="Bars per segment"),
    bpm: Optional[float] = typer.Option(None, "--bpm", help="BPM (auto-detect if not provided)"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Export chunks to directory"),
):
    """Segment audio at beat/bar boundaries.

    Examples:
        sample-analysis segment beats track.wav --bars 4
        sample-analysis segment beats loop.wav --bars 8 --output segments/
    """
    from sample_analysis.segmentation import segment_by_beats

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        chunks = segment_by_beats(
            audio_path,
            bars_per_chunk=bars,
            bpm=bpm,
            output_dir=output_dir,
            export=output_dir is not None,
        )

        rprint(f"[green]Created {len(chunks)} segments ({bars} bars each):[/green]")
        for i, chunk in enumerate(chunks):
            rprint(f"  {i + 1}. {chunk.start_time:.2f}s - {chunk.end_time:.2f}s ({chunk.duration:.2f}s)")
            if chunk.path:
                rprint(f"     [dim]→ {chunk.path}[/dim]")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@segment_app.command("changepoint")
def segment_changepoint(
    audio_path: Path = typer.Argument(..., help="Path to audio file"),
    min_duration: float = typer.Option(30.0, "--min-duration", help="Minimum segment duration (seconds)"),
    n_segments: Optional[int] = typer.Option(None, "--segments", "-n", help="Target number of segments"),
    method: str = typer.Option("rbf", "--method", "-m", help="Detection method (rbf, l2, linear)"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Export chunks to directory"),
):
    """Segment audio at change points (for live recordings, mixes).

    Examples:
        sample-analysis segment changepoint liveset.wav --output songs/
        sample-analysis segment changepoint mix.wav --segments 10
    """
    from sample_analysis.segmentation import segment_by_changepoint

    if not audio_path.exists():
        rprint(f"[red]Error:[/red] File not found: {audio_path}")
        raise typer.Exit(1)

    try:
        chunks = segment_by_changepoint(
            audio_path,
            min_segment_duration=min_duration,
            n_segments=n_segments,
            method=method,
            output_dir=output_dir,
            export=output_dir is not None,
        )

        rprint(f"[green]Found {len(chunks)} segments:[/green]")
        for i, chunk in enumerate(chunks):
            rprint(f"  {i + 1}. {chunk.start_time:.2f}s - {chunk.end_time:.2f}s ({chunk.duration:.2f}s)")
            if chunk.path:
                rprint(f"     [dim]→ {chunk.path}[/dim]")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYZERS SUBCOMMANDS
# ═══════════════════════════════════════════════════════════════════════════════


ANALYZER_INFO = {
    "bpm": {
        "description": "BPM detection and beat tracking",
        "requires": "Rust native (built-in)",
    },
    "key": {
        "description": "Musical key detection",
        "requires": "Rust native (built-in)",
    },
    "quality": {
        "description": "Audio quality metrics (RMS, peak, crest factor)",
        "requires": "Rust native (built-in)",
    },
    "spectral": {
        "description": "Spectral features (centroid, rolloff, MFCCs)",
        "requires": "Rust native (built-in)",
    },
    "spectrogram": {
        "description": "Mel spectrogram generation",
        "requires": "Rust native (built-in)",
    },
    "transient": {
        "description": "Transient/onset detection",
        "requires": "Rust native (built-in)",
    },
    "loop": {
        "description": "Loop quality analysis",
        "requires": "Rust native (built-in)",
    },
    "embedding": {
        "description": "CLAP audio embeddings for similarity",
        "requires": "laion-clap, torch",
    },
    "fingerprint": {
        "description": "Audio fingerprinting (Chromaprint)",
        "requires": "pyacoustid",
    },
}


@analyzers_app.command("list")
def analyzers_list():
    """List available analyzers and their status.

    Shows all registered analyzers and whether their dependencies are installed.
    """
    from sample_analysis.analyzers import get_analyzer, list_analyzers

    available = list_analyzers()

    table = Table(title="Audio Analyzers")
    table.add_column("Analyzer", style="cyan")
    table.add_column("Available", justify="center")
    table.add_column("Requires")
    table.add_column("Description")

    for name, info in ANALYZER_INFO.items():
        is_available = name in available
        status = "[green]✓[/green]" if is_available else "[red]✗[/red]"

        table.add_row(
            name,
            status,
            info["requires"],
            info["description"],
        )

    console.print(table)

    rprint("\n[dim]Install optional analyzers with:[/dim]")
    rprint("  pip install sample-analysis[embedding] # CLAP embeddings")
    rprint("  pip install sample-analysis[fingerprint] # Audio fingerprinting")
    rprint("  pip install sample-analysis[all]      # All analyzers")


if __name__ == "__main__":
    app()
