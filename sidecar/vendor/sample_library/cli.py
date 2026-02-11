"""Command-line interface for sample-library."""

from pathlib import Path
from typing import Optional

import typer
from rich import print as rprint
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn

app = typer.Typer(help="Sample library management for electronic music")
console = Console()


def _ensure_db():
    """Ensure the database is initialized with default path."""
    from sample_library import init_db, NATIVE_AVAILABLE

    if not NATIVE_AVAILABLE:
        return False

    default_path = Path.home() / ".music-hub-data" / "sample-library" / "library.db"
    default_path.parent.mkdir(parents=True, exist_ok=True)
    init_db(str(default_path))
    return True


@app.command()
def init(
    db_path: Optional[Path] = typer.Option(
        None,
        "--db",
        "-d",
        help="Database path (default: ~/.music-hub-data/sample-library/library.db)",
    ),
):
    """Initialize the sample library database."""
    try:
        from sample_library import init_db, NATIVE_AVAILABLE

        if not NATIVE_AVAILABLE:
            rprint("[yellow]Warning:[/yellow] Native backend not available. Using pure Python.")
            rprint("Install native backend with: pip install sample-library")
            return

        if db_path:
            init_db(str(db_path))
            rprint(f"[green]Initialized database:[/green] {db_path}")
        else:
            # Use default path
            default_path = Path.home() / ".music-hub-data" / "sample-library" / "library.db"
            default_path.parent.mkdir(parents=True, exist_ok=True)
            init_db(str(default_path))
            rprint(f"[green]Initialized database:[/green] {default_path}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def stats():
    """Show library statistics."""
    try:
        from sample_library import count_samples, get_packs, get_tags, NATIVE_AVAILABLE

        if not _ensure_db():
            rprint("[red]Error:[/red] Native backend not available.")
            raise typer.Exit(1)

        sample_count = count_samples()
        packs = get_packs()
        tags = get_tags()

        table = Table(title="Library Statistics")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Total Samples", str(sample_count))
        table.add_row("Packs", str(len(packs)))
        table.add_row("Tags", str(len(tags)))

        console.print(table)

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("import")
def import_samples(
    directory: Path = typer.Argument(..., help="Directory to import"),
    recursive: bool = typer.Option(True, "--recursive/--no-recursive", help="Scan subdirectories"),
    analyze: bool = typer.Option(True, "--analyze/--no-analyze", help="Run audio analysis"),
    workers: int = typer.Option(4, "--workers", "-w", help="Number of parallel workers"),
):
    """Import samples from a directory."""
    from sample_library.batch_import import batch_import, ImportProgress, ImportPhase

    if not directory.exists():
        rprint(f"[red]Error:[/red] Directory not found: {directory}")
        raise typer.Exit(1)

    def progress_callback(progress: ImportProgress):
        pass  # Progress handled by rich

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Importing...", total=None)

        def update_progress(p: ImportProgress):
            progress.update(
                task,
                description=f"[{p.phase.value}] {p.current_file or ''} ({p.current}/{p.total})"
            )

        result = batch_import(
            directory,
            recursive=recursive,
            analyze=analyze,
            workers=workers,
            progress_callback=update_progress,
        )

    rprint(f"\n[green]Import complete![/green]")
    rprint(f"  Scanned: {result.total} files")
    rprint(f"  Duplicates skipped: {result.duplicates_skipped}")

    if result.errors:
        rprint(f"\n[yellow]Errors ({len(result.errors)}):[/yellow]")
        for filepath, error in result.errors[:5]:
            rprint(f"  - {filepath}: {error}")
        if len(result.errors) > 5:
            rprint(f"  ... and {len(result.errors) - 5} more")


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    sample_type: Optional[str] = typer.Option(None, "--type", "-t", help="Filter by type"),
    min_bpm: Optional[float] = typer.Option(None, "--min-bpm", help="Minimum BPM"),
    max_bpm: Optional[float] = typer.Option(None, "--max-bpm", help="Maximum BPM"),
    limit: int = typer.Option(20, "--limit", "-n", help="Maximum results"),
):
    """Search the sample library."""
    try:
        from sample_library import get_samples

        if not _ensure_db():
            rprint("[red]Error:[/red] Native backend not available.")
            raise typer.Exit(1)

        samples = get_samples(
            limit=limit,
            sample_type=sample_type,
            min_bpm=min_bpm,
            max_bpm=max_bpm,
        )

        if not samples:
            rprint("[yellow]No samples found.[/yellow]")
            return

        table = Table(title=f"Search Results ({len(samples)})")
        table.add_column("ID", style="dim")
        table.add_column("Name")
        table.add_column("Type")
        table.add_column("BPM")
        table.add_column("Key")
        table.add_column("Score")

        for sample in samples:
            name = Path(sample["path"]).name
            table.add_row(
                str(sample["id"]),
                name[:40] + "..." if len(name) > 40 else name,
                sample.get("sample_type") or "-",
                f"{sample['bpm']:.0f}" if sample.get("bpm") else "-",
                sample.get("key") or "-",
                f"{sample['applicability_score']:.0f}" if sample.get("applicability_score") else "-",
            )

        console.print(table)

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def similar(
    sample_id: int = typer.Argument(..., help="Sample ID to find similar samples for"),
    limit: int = typer.Option(10, "--limit", "-n", help="Number of results"),
):
    """Find samples similar to a given sample."""
    try:
        from sample_library import search_similar, get_sample

        if not _ensure_db():
            rprint("[red]Error:[/red] Native backend not available.")
            raise typer.Exit(1)

        # Get the query sample info
        query_sample = get_sample(sample_id)
        if not query_sample:
            rprint(f"[red]Error:[/red] Sample {sample_id} not found.")
            raise typer.Exit(1)

        rprint(f"[cyan]Finding samples similar to:[/cyan] {Path(query_sample['path']).name}")

        results = search_similar(sample_id, limit=limit)

        if not results:
            rprint("[yellow]No similar samples found.[/yellow]")
            return

        table = Table(title=f"Similar Samples ({len(results)})")
        table.add_column("ID", style="dim")
        table.add_column("Name")
        table.add_column("Similarity")

        for result in results:
            sample = get_sample(result["sample_id"])
            if sample:
                name = Path(sample["path"]).name
                table.add_row(
                    str(result["sample_id"]),
                    name[:50] + "..." if len(name) > 50 else name,
                    f"{result['similarity']:.1%}",
                )

        console.print(table)

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def embeddings(
    batch_size: int = typer.Option(100, "--batch-size", "-b", help="Number of samples per batch"),
):
    """Generate embeddings for samples that don't have them."""
    try:
        from sample_library import (
            generate_embeddings as gen_embed,
            get_samples_without_embeddings,
            count_samples,
        )

        if not _ensure_db():
            rprint("[red]Error:[/red] Native backend not available.")
            raise typer.Exit(1)

        # Check how many samples need embeddings
        pending = get_samples_without_embeddings(limit=1000)
        total_samples = count_samples()

        if not pending:
            rprint("[green]✓[/green] All samples have embeddings!")
            return

        rprint(f"[cyan]Generating embeddings for {len(pending)} samples...[/cyan]")

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Generating embeddings...", total=None)

            total_generated = 0
            while True:
                count = gen_embed(batch_size=batch_size)
                if count == 0:
                    break
                total_generated += count
                progress.update(
                    task,
                    description=f"Generated {total_generated} embeddings..."
                )

        rprint(f"\n[green]✓[/green] Generated {total_generated} embeddings")
        rprint(f"  Total samples in library: {total_samples}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def tags(
    sample_id: Optional[int] = typer.Option(None, "--sample", "-s", help="Show tags for a sample"),
):
    """List tags in the library."""
    try:
        from sample_library import get_tags, get_sample_tags

        if not _ensure_db():
            rprint("[red]Error:[/red] Native backend not available.")
            raise typer.Exit(1)

        if sample_id:
            tags = get_sample_tags(sample_id)
            rprint(f"[cyan]Tags for sample {sample_id}:[/cyan]")
            if tags:
                for tag in tags:
                    rprint(f"  - {tag}")
            else:
                rprint("  (no tags)")
        else:
            all_tags = get_tags()
            rprint(f"[cyan]All tags ({len(all_tags)}):[/cyan]")
            for tag in all_tags:
                rprint(f"  - {tag['name']}")

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
