//! Python sidecar process management.
//!
//! Two launch paths:
//!
//! 1. **Bundled** (production .dmg). PyInstaller produces a one-folder
//!    bundle at `sidecar/dist/sample-curation-api/`. Tauri's
//!    `bundle.resources` copies that to `Contents/Resources/sidecar/`
//!    in the .app. We launch `<Resources>/sidecar/sample-curation-api`
//!    directly — no Python interpreter, no `uv` on PATH required.
//!
//! 2. **Dev** (`npm start`). The bundled binary doesn't exist next to
//!    the dev exe, so we fall back to `uv run python run_sidecar.py`
//!    rooted at `<repo>/sidecar/`. This keeps fast iteration: edits
//!    to handler files are picked up on next launch with no rebuild.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

pub struct SidecarManager {
    _process: Child,
    stdin: ChildStdin,
    response_rx: Receiver<String>,
}

/// Walk up from `current_exe()` to find a `Contents/Resources/` dir
/// (the .app layout on macOS). Returns the bundled sidecar binary if
/// it exists and is executable.
fn find_bundled_sidecar() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // .../Sample Curator.app/Contents/MacOS/sample-curator
    //                                ^^^^^ MacOS dir
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }
    let candidate = contents_dir
        .join("Resources")
        .join("sidecar")
        .join("sample-curation-api");
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn spawn_command(
    mut command: Command,
    label: &str,
) -> Result<Child, Box<dyn std::error::Error>> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| {
            format!("Failed to spawn {} sidecar: {}", label, e).into()
        })
}

impl SidecarManager {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        // Try the bundled binary first — present in production .dmg installs.
        let process = if let Some(bundled) = find_bundled_sidecar() {
            eprintln!("[sidecar] launching bundled binary at {}", bundled.display());
            spawn_command(Command::new(&bundled), "bundled")?
        } else {
            launch_dev_sidecar()?
        };
        Self::wrap(process)
    }

    fn wrap(mut process: Child) -> Result<Self, Box<dyn std::error::Error>> {

        let stdin = process.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = process.stdout.take().ok_or("Failed to get stdout")?;

        // Create channel for responses
        let (tx, rx): (Sender<String>, Receiver<String>) = mpsc::channel();

        // Spawn thread to read responses
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            }
        });

        Ok(Self {
            _process: process,
            stdin,
            response_rx: rx,
        })
    }
}

/// Dev-mode launch: `uv run python run_sidecar.py` rooted at the
/// in-repo sidecar/ dir. Picks up the `.venv` that `npm run setup`
/// created and re-syncs missing deps on first run.
fn launch_dev_sidecar() -> Result<Child, Box<dyn std::error::Error>> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap());

    let sidecar_dir = manifest_dir
        .parent()
        .map(|p: &Path| p.join("sidecar"))
        .unwrap_or_else(|| manifest_dir.join("sidecar"));
    let sidecar_script = sidecar_dir.join("run_sidecar.py");

    if !sidecar_dir.join("pyproject.toml").exists() {
        eprintln!(
            "Warning: sidecar pyproject.toml not found at {}. Python sidecar will likely fail to find deps.",
            sidecar_dir.display()
        );
    }

    eprintln!("[sidecar] launching dev sidecar via `uv run` at {}", sidecar_dir.display());
    let mut command = Command::new("uv");
    command
        .args(["run", "python", sidecar_script.to_str().unwrap()])
        .current_dir(&sidecar_dir);
    spawn_command(command, "dev (uv run)")
}

impl SidecarManager {
    pub fn call_sync(&mut self, request: &str) -> Result<String, Box<dyn std::error::Error>> {
        // Write request
        writeln!(self.stdin, "{}", request)?;
        self.stdin.flush()?;

        // Read response (with timeout)
        let response = self
            .response_rx
            .recv_timeout(std::time::Duration::from_secs(60))?;

        Ok(response)
    }
}
