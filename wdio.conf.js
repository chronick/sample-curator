import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { platform } from "node:os";

// Path to the debug binary built by `npm run test:e2e:build`
const getBinaryPath = () => {
  const base = resolve("src-tauri/target/debug");
  if (platform() === "darwin") {
    return resolve(base, "sample-curator");
  } else if (platform() === "win32") {
    return resolve(base, "sample-curator.exe");
  }
  return resolve(base, "sample-curator");
};

let tauriDriver;

export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./e2e/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: getBinaryPath(),
      },
    },
  ],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  reporters: ["spec"],
  runner: "local",
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 3,

  onPrepare() {
    // Start the CrabNebula tauri-driver on port 4444
    tauriDriver = spawn("npx", ["@crabnebula/tauri-driver"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the driver to be ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(); // Proceed even if we don't see the ready message
      }, 5_000);

      tauriDriver.stdout.on("data", (data) => {
        const msg = data.toString();
        if (msg.includes("listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      tauriDriver.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start tauri-driver: ${err.message}`));
      });
    });
  },

  onComplete() {
    if (tauriDriver) {
      tauriDriver.kill();
      tauriDriver = null;
    }
  },
};
