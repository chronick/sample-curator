// Type declarations for Tauri v2 globals

interface Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  __TAURI_IPC__?: (message: unknown) => void;
}
