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

        // The sidecar is at ../sidecar/run_sidecar.py relative to src-tauri
        let sidecar_script = manifest_dir
            .parent()
            .map(|p| p.join("sidecar").join("run_sidecar.py"))
            .unwrap_or_else(|| manifest_dir.join("sidecar").join("run_sidecar.py"));

        // The music-hub project root (for uv to find dependencies)
        let project_root = manifest_dir
            .parent() // sample-curator
            .and_then(|p| p.parent()) // packages
            .and_then(|p| p.parent()) // music-hub
            .unwrap_or_else(|| &manifest_dir);

        // Spawn the Python sidecar process using uv
        let mut process = Command::new("uv")
            .args(["run", "python", sidecar_script.to_str().unwrap()])
            .current_dir(project_root)
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
