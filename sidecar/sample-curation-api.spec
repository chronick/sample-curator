# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Sample Curator sidecar.

Produces a `dist/sample-curation-api/` folder (one-folder mode) that
the Tauri shell ships inside `.app/Contents/Resources/sidecar/`. One-
folder mode boots ~3-5x faster than one-file because nothing has to
unpack to a temp dir before importing librosa/numpy.

Run:
    cd sidecar
    uv sync --extra bundle
    uv run pyinstaller sample-curation-api.spec --clean

The output binary is `dist/sample-curation-api/sample-curation-api`
and the supporting libs sit alongside it.

vault-3bd8 — see beads task for scope. v1: core sidecar only (no
embedding/fingerprint/llm extras — those bundle separately later
under the model-download flow in vault-knuo).
"""

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

# ============ Hidden imports ============
# librosa/numba/joblib don't fully discover their own optional
# subpackages via static analysis — collect_submodules paves over that.
hiddenimports = []
for pkg in (
    "librosa",
    "numba",
    "audioread",
    "soundfile",
    "scipy",
    "scipy.signal",
    "scipy.special",
    "joblib",
    "lazy_loader",
    "sklearn.utils._typedefs",
    "sklearn.neighbors._partition_nodes",
    "pooch",
):
    try:
        hiddenimports.extend(collect_submodules(pkg))
    except Exception:
        # Optional / version-dependent — keep going
        pass

# Vendored packages that live under sidecar/vendor/ rather than as
# pip-installed deps. PyInstaller can't see them via normal import
# resolution because run_sidecar.py mutates sys.path at runtime.
hiddenimports += [
    "sample_analysis",
    "sample_library",
    "sample_curation_api",
    "sample_curation_api.handlers",
    "sample_curation_api.naming",
    "sample_curation_api.ollama_status",
    "sample_curation_api.llm",
    "sample_curation_api.models",
]

# ============ Data files ============
# librosa ships small data tables (musical intervals, Mel filterbanks).
datas = []
for pkg in ("librosa", "soundfile", "audioread"):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

# Include the sidecar package's METADATA so importlib.metadata.version
# returns a real string (not "unknown") when frozen.
try:
    datas += copy_metadata("sample-curation-api")
except Exception:
    pass

# vault-3ume: the LLM prompt template is read at module load via
# ``Path(__file__).parent / "llm_prompt.txt"``. PyInstaller doesn't pick
# up sibling data files automatically — bundle it explicitly so the frozen
# sidecar can find it. Same source-of-truth file is read by Rust at
# compile time via ``include_str!``.
datas += [("sample_curation_api/llm_prompt.txt", "sample_curation_api")]

# ============ Build ============
a = Analysis(
    ["run_sidecar.py"],
    pathex=["vendor"],  # so vendored sample_analysis/sample_library resolve
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Heavy ML extras are out of scope for v1 — see vault-knuo for
        # the on-demand model download flow that will pull these in.
        "torch",
        "transformers",
        "tensorflow",
        "demucs",
        "matchering",
        "laion_clap",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sample-curation-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX trips macOS Gatekeeper signing
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,  # set by --target-arch flag at build time
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="sample-curation-api",
)
