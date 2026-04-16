//! Python sidecar process management.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

pub struct SidecarManager {
    _process: Child,
    stdin: ChildStdin,
    response_rx: Receiver<String>,
}

impl SidecarManager {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        // Find the sidecar script relative to the tauri manifest
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::current_dir().unwrap());

        // The sidecar's Python package + pyproject.toml live at
        // sample-curator/sidecar/, two dirs up from the Tauri manifest's parent.
        // We run `uv run` from that dir so it picks up the sidecar's own venv
        // (which has librosa, numpy, soundfile, etc.). Running from anywhere
        // else leaves `uv` hunting for a pyproject.toml it can't find, or
        // worse, activating some unrelated venv that lacks our deps.
        let sidecar_dir = manifest_dir
            .parent()
            .map(|p| p.join("sidecar"))
            .unwrap_or_else(|| manifest_dir.join("sidecar"));
        let sidecar_script = sidecar_dir.join("run_sidecar.py");

        if !sidecar_dir.join("pyproject.toml").exists() {
            eprintln!(
                "Warning: sidecar pyproject.toml not found at {}. Python sidecar will likely fail to find deps.",
                sidecar_dir.display()
            );
        }

        // Spawn the Python sidecar process using uv. Use the sidecar-api
        // entrypoint declared in pyproject.toml; it syncs deps on first run
        // if the venv is missing.
        let mut process = Command::new("uv")
            .args(["run", "python", sidecar_script.to_str().unwrap()])
            .current_dir(&sidecar_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

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
