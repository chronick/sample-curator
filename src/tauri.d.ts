// Type declarations for Tauri globals

interface Window {
  __TAURI__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    // Add other Tauri APIs as needed
  };
  __TAURI_IPC__?: (message: unknown) => void;
}
