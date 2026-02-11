# Sample Curator - Claude Code Guide

## Project Overview

Desktop application for browsing, importing, tagging, and managing audio samples.

**Tech**: Tauri (Rust) + React/TypeScript + Python JSON-RPC sidecar
**Purpose**: GUI for sample library management with waveform preview and batch operations

## Design Philosophy: Self-Contained Hub

Sample-curator is the primary hub for sample management. The Rust crates (`sample-analysis-core`, `sample-library-core`) now live locally under `src-tauri/crates/`, and Python packages (`sample_analysis`, `sample_library`) are vendored in `sidecar/vendor/`.

- **Rust crates**: DB operations, audio analysis, and similarity search run natively via Tauri commands
- **Python sidecar**: Reserved for future ML features (CLAP embeddings, semantic search, stem separation)
- **Vendor dir**: Contains Python packages for when ML features need `sample_analysis`/`sample_library` APIs

## Architecture

```
sample-curator/
├── src/                           # React frontend (Vite + TypeScript)
│   ├── components/                # UI components
│   ├── hooks/                     # React hooks (useRpc, useLibrary, etc.)
│   ├── stores/                    # Zustand state management
│   └── types/                     # TypeScript interfaces
├── src-tauri/                     # Tauri shell (Rust)
│   ├── Cargo.toml                 # Workspace root + app package
│   ├── src/                       # Tauri app code
│   └── crates/
│       ├── sample-analysis-core/  # Audio analysis (BPM, key, spectral, etc.)
│       └── sample-library-core/   # DB, embeddings, similarity search
└── sidecar/                       # Python backend (ML features)
    ├── pyproject.toml             # Python dependencies
    ├── sample_curation_api/       # JSON-RPC handlers
    │   ├── __init__.py            # Entry point + main loop
    │   └── handlers.py            # RPC method implementations
    └── vendor/                    # Vendored Python packages
        ├── sample_analysis/       # Python analysis API (for future ML features)
        └── sample_library/        # Python library API (for future ML features)
```

## Quick Start

```bash
npm run setup   # Install npm + Python deps
npm start       # Run the app
```

## Development Workflow

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Install all deps (npm + Python sidecar) |
| `npm start` | Run full app (Tauri + sidecar) |
| `npm run dev` | Frontend only (Vite dev server) |
| `npm run build` | Production build (frontend + Tauri) |
| `npm run sidecar:sync` | Reinstall Python deps |
| `npm run sidecar:test` | Run sidecar tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |

### Frontend Only (React/TypeScript)

```bash
npm run dev        # Vite dev server at localhost:5173
npm run typecheck  # Type checking
npm run lint       # Linting
```

### Full Desktop App (Tauri)

```bash
npm start          # Dev mode with hot reload
npm run build      # Production build
```

### Python Sidecar

```bash
npm run sidecar:sync   # Install/update deps
npm run sidecar:test   # Run tests

# Or directly:
cd sidecar
uv run sample-curation-api   # Run standalone
uv run pytest                # Run tests
```

## JSON-RPC Protocol

The frontend communicates with the Python sidecar over stdio using JSON-RPC 2.0.

### Request Format
```json
{"jsonrpc": "2.0", "method": "search", "params": {"tags": ["kick"]}, "id": 1}
```

### Response Format
```json
{"jsonrpc": "2.0", "result": [...], "id": 1}
```

### Available Methods

| Method | Description |
|--------|-------------|
| `search` | Search samples by tags, type, BPM range, score |
| `get_sample` | Get full sample details by ID |
| `list_packs` | List all sample packs |
| `list_tags` | List all available tags |
| `start_import` | Begin async import job |
| `get_import_progress` | Poll import status |
| `cancel_import` | Cancel running import |
| `update_sample` | Update sample metadata |
| `delete_sample` | Remove sample from library |
| `analyze_sample` | Run analysis on sample |
| `get_waveform` | Get waveform data for visualization |
| `add_tags` / `remove_tags` | Manage sample tags |
| `batch_update` / `batch_delete` / `batch_add_tags` | Bulk operations |

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main React component |
| `src/hooks/useRpc.ts` | JSON-RPC client hook |
| `src/stores/libraryStore.ts` | Sample library state |
| `src-tauri/src/main.rs` | Tauri setup + sidecar management |
| `sidecar/sample_curation_api/handlers.py` | All RPC implementations |

## Frontend State Management

Uses Zustand for state. Key stores:

- **libraryStore**: Samples, search results, selection
- **importStore**: Import progress, errors
- **playerStore**: Audio playback state

## Adding a New RPC Method

1. Add handler function in `sidecar/sample_curation_api/handlers.py`
2. Register in `HANDLERS` dict
3. Add TypeScript types in `src/types/`
4. Create React hook if needed in `src/hooks/`
5. Test with standalone sidecar first

## Database

Uses SQLite via SQLAlchemy (from sample-library):
- Location: `~/.music-hub-data/sample-library/library.db`
- Models: Sample, Pack, Tag
- Initialized automatically on first use

## Testing

### Frontend
```bash
npm run typecheck  # Type checking only (no unit tests yet)
```

### Sidecar
```bash
cd sidecar
uv run pytest
```

### Manual Testing
```bash
# Run sidecar standalone and send JSON-RPC
cd sidecar
uv run sample-curation-api <<< '{"jsonrpc":"2.0","method":"list_tags","params":{},"id":1}'
```

## Dependencies

### Frontend
- React 18 + TypeScript
- TailwindCSS for styling
- @tanstack/react-virtual for virtualized lists
- Zustand for state management
- @tauri-apps/api for Tauri IPC

### Sidecar (Python)
Core dependencies are inlined in pyproject.toml for self-sufficiency:
- **Database**: sqlalchemy, pydantic
- **Audio**: soundfile, numpy, scipy, librosa
- **CLI**: typer, rich

Optional extras for heavy features:
- `[embedding]`: CLAP embeddings (torch, laion-clap)
- `[fingerprint]`: Audio fingerprinting (pyacoustid)
- `[all]`: Everything

## Common Issues

### Sidecar won't start
- Check Python version: requires 3.11+
- Ensure `uv sync` was run in sidecar/
- Check Tauri config points to correct sidecar binary

### Import hangs
- Large directories can take time; check progress endpoint
- Watch sidecar logs in dev console

### Waveform not showing
- Ensure numpy is installed
- Check file format is supported (.wav, .aif, .flac, .mp3, .ogg)

## Integration Points

- **sample-library-core** (Rust crate, local): Database and import logic — `src-tauri/crates/sample-library-core/`
- **sample-analysis-core** (Rust crate, local): Analyzers for BPM, key, quality metrics — `src-tauri/crates/sample-analysis-core/`
- **music-hub**: Can be launched via `music-hub curate` command
