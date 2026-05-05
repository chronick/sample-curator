# Sample Curator

Desktop application for managing your audio sample library. Browse, import, tag, and organize samples with waveform visualization and batch operations.

## Features

- Browse samples with waveform previews
- Search by tags, BPM range, sample type, and quality score
- Import samples with automatic analysis (BPM, key, quality metrics)
- Batch tagging and organization
- Pack management for vendor libraries
- Duplicate detection via audio fingerprinting

## Requirements

- **Node.js** 18+
- **Python** 3.11+
- **uv** (Python package manager)
- **Rust** (for Tauri builds)
- **ollama** (optional) — for LLM-refined vocal sample names

## Quick Start

```bash
# Install everything (npm + Python sidecar)
npm run setup

# Run the app
npm start
```

That's it. The `setup` script installs both frontend and Python dependencies.

## Installation (Manual)

If you prefer step-by-step:

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Install Python Sidecar

```bash
npm run sidecar:sync
```

### 3. Run in Development Mode

```bash
npm start
```

This starts both the Vite dev server and Tauri app.

### 4. Enable LLM Vocal Naming (Optional)

Vocal samples are transcribed by Whisper and can be further refined by a local LLM into more evocative filenames (e.g. *'we ride the eternal wave'* → *'eternal-wave-chant'* instead of the mechanical *'ride-eternal-wave'*). Without this, the LLM tier is silently skipped and the mechanical name is used.

```bash
# 1. Install ollama
brew install ollama
# or: download from https://ollama.com/download

# 2. Start the daemon
brew services start ollama
# or: `ollama serve` to run in the foreground

# 3. Pull a small, fast model (one-time)
#    The sidecar auto-detects the first match from this ranked list:
#      gemma4:e2b → gemma3:1b → qwen2.5:3b
ollama pull gemma3:1b

# 4. Install the LLM sidecar extra
cd sidecar && uv sync --extra llm
```

To use a different model, either set `SAMPLE_CURATOR_OLLAMA_MODEL=<model-tag>` in the environment before launching the app (hard override, disables auto-detect), or persist a choice via the `set_ollama_model` RPC.

## Usage

### Importing Samples

1. Click the **Import** button
2. Select a folder containing audio files
3. Configure import options:
   - Recursive scan
   - Auto-analyze (BPM, key, quality)
   - Duplicate detection
4. Click **Start Import**
5. Monitor progress in the status bar

### Browsing

- Use the search bar to filter by text
- Click tags in the sidebar to filter
- Sort by BPM, date added, or quality score
- Use keyboard shortcuts:
  - `Space` - Play/pause selected sample
  - `Enter` - Open sample details
  - `⌘+A` - Select all
  - `Delete` - Remove selected samples

### Tagging

- Right-click samples for context menu
- Use bulk actions for multiple samples
- Create new tags on the fly

## Building for Production

```bash
npm run tauri:build
```

Output will be in `src-tauri/target/release/bundle/`.

## Releases (prod app + auto-update)

The prod app installs alongside the dev build (different macOS bundle identifier) and auto-updates from GitHub Releases.

### One-time keypair setup

Updates are signed with a Tauri-specific keypair (independent of Apple Developer ID). Generate it once on a trusted local machine:

```bash
npx tauri signer generate -w ~/.tauri/sample-curator.key
```

The command prints a **public key** (paste into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`) and a **private key** (file `~/.tauri/sample-curator.key`, plus the password you chose). Keep both safe — losing the private key means existing installs can't accept future updates.

Set the private key + password as repo secrets:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/sample-curator.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body "<password>"
```

### Cutting a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `Release` workflow builds a universal `.dmg` on a macOS runner, signs the updater bundle with the Tauri key, and publishes a **draft** GitHub Release with `latest.json` + `.dmg` attached. Review the draft, then publish — installed prod apps poll `releases/latest/download/latest.json` and will offer the update.

### First-launch Gatekeeper warning (Apple-unsigned)

Builds are not yet signed with an Apple Developer ID, so Gatekeeper will refuse to open the `.dmg` on a fresh Mac. Workaround:

```bash
xattr -d com.apple.quarantine /Applications/Sample\ Curator.app
```

After that the app launches normally. (Apple Developer ID signing is tracked separately in vault-h9il.)

### Dev / prod coexistence

| Build | Identifier | Bundle name | Updater |
|-------|------------|-------------|---------|
| Dev (`npm start`) | `com.music-hub.sample-curator.dev` | `Sample Curator (Dev)` | disabled |
| Prod (release) | `com.music-hub.sample-curator` | `Sample Curator` | enabled |

Both share `~/.music-hub-data/` (library DB + recordings) and have isolated app config / window state under `~/Library/Application Support/<identifier>/`.

## Configuration

The app stores data in `~/.music-hub-data/`:

```
~/.music-hub-data/
├── sample-library/
│   └── library.db      # SQLite database
└── config.toml         # User preferences
```

## Python Sidecar

The backend is a Python JSON-RPC server that handles:
- Database operations
- Audio file analysis
- Waveform generation
- Import pipeline

### Monorepo Dependencies

The sidecar depends on sibling packages in this monorepo:
- `sample-library` - Database models, import pipeline, scoring
- `sample-analysis` - BPM/key detection, quality metrics

These are resolved via `[tool.uv.sources]` in `pyproject.toml` as editable path dependencies. When you run `uv sync`, uv automatically links them from `../../sample-library` and `../../sample-analysis`.

### Running Standalone

For debugging, run the sidecar directly:

```bash
cd sidecar
uv run sample-curation-api
```

Send JSON-RPC requests via stdin:

```bash
echo '{"jsonrpc":"2.0","method":"list_tags","params":{},"id":1}' | uv run sample-curation-api
```

### Dependency Extras

Install only what you need:

```bash
# Core functionality
uv sync

# With audio fingerprinting
uv sync --extra fingerprint

# With CLAP embeddings for similarity search
uv sync --extra embedding

# Everything
uv sync --extra all
```

## Development

### Project Structure

```
sample-curator/
├── src/                     # React frontend
├── src-tauri/               # Tauri (Rust) shell
├── sidecar/                 # Python backend
│   ├── pyproject.toml       # Python deps
│   └── sample_curation_api/ # RPC handlers
├── package.json             # Node deps
└── CLAUDE.md                # Development guide
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Tauri (Rust) |
| Frontend | React 18, TypeScript, TailwindCSS |
| State | Zustand |
| Virtualization | @tanstack/react-virtual |
| Backend | Python 3.11+, JSON-RPC over stdio |
| Database | SQLite via SQLAlchemy |
| Audio Analysis | librosa, soundfile |

### Adding Features

1. Check `CLAUDE.md` for architecture details
2. Frontend changes go in `src/`
3. Backend changes go in `sidecar/sample_curation_api/`
4. Run `npm run typecheck` before committing

## Troubleshooting

### "Module not found" errors in sidecar

```bash
cd sidecar
uv sync --extra all
```

### Tauri build fails

Ensure Rust is installed:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Database locked

Close any other processes using the library (music-hub CLI, other curator instances).

## License

MIT
