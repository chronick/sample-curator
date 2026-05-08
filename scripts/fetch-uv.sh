#!/usr/bin/env bash
# Fetch the `uv` binary into src-tauri/resources/ for bundling (vault-347l Phase 2).
#
# uv ends up at `Sample Curator.app/Contents/Resources/uv` in production
# builds and is used by the Rust deps_install command to manage a runtime
# venv at ~/.music-hub-data/python/runtime/ (which holds the heavy ML
# libs that the frozen sidecar can't pip-install).
#
# Apple Silicon-only for v1 — Sample Curator targets Apple Silicon Macs
# only. Cross-platform fan-out is a follow-up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$REPO_ROOT/src-tauri/resources"
UV_DEST="$RESOURCES_DIR/uv"

# Pin a known-good version; bump deliberately when newer features are
# needed. Keeps prod-bundle reproducible across CI runs.
UV_VERSION="${UV_VERSION:-0.5.11}"

# Detect platform — we only support aarch64-apple-darwin in v1, but
# fail loudly on x86_64 instead of silently producing an x86 bundle.
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    UV_TARGET="aarch64-apple-darwin"
    ;;
  Darwin/x86_64)
    echo "ERROR: x86_64 macOS is not supported in v1 (vault-347l ships Apple Silicon-only)." >&2
    exit 1
    ;;
  *)
    echo "ERROR: unsupported platform $(uname -s)/$(uname -m)" >&2
    exit 1
    ;;
esac

mkdir -p "$RESOURCES_DIR"

# Skip refetch if we already have a uv at this version.
if [[ -x "$UV_DEST" ]]; then
  CURRENT="$("$UV_DEST" --version 2>/dev/null | awk '{print $2}' || echo "")"
  if [[ "$CURRENT" == "$UV_VERSION" ]]; then
    echo "uv $UV_VERSION already present at $UV_DEST"
    exit 0
  fi
  echo "uv version drift detected (have $CURRENT, want $UV_VERSION) — refetching"
fi

URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Fetching $URL"
curl --fail --location --silent --show-error -o "$TMPDIR/uv.tar.gz" "$URL"

tar -xzf "$TMPDIR/uv.tar.gz" -C "$TMPDIR"

# Tarball layout: uv-aarch64-apple-darwin/uv (and uvx)
EXTRACTED="$TMPDIR/uv-${UV_TARGET}/uv"
if [[ ! -x "$EXTRACTED" ]]; then
  echo "ERROR: extracted archive missing uv binary at $EXTRACTED" >&2
  ls -la "$TMPDIR" "$TMPDIR/uv-${UV_TARGET}" >&2 || true
  exit 1
fi

cp "$EXTRACTED" "$UV_DEST"
chmod +x "$UV_DEST"

# Sanity check the binary actually runs and reports the expected version.
ACTUAL="$("$UV_DEST" --version 2>/dev/null | awk '{print $2}')"
if [[ "$ACTUAL" != "$UV_VERSION" ]]; then
  echo "ERROR: bundled uv reports version '$ACTUAL', expected '$UV_VERSION'" >&2
  exit 1
fi

echo "OK: uv $ACTUAL bundled at $UV_DEST"
