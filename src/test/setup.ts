import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Provide minimal Tauri internals stubs so that dynamic import() calls
// to @tauri-apps/api modules don't crash in the test environment.
(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: vi.fn().mockResolvedValue(null),
  transformCallback: vi.fn().mockReturnValue(0),
  convertFileSrc: vi.fn(),
  metadata: {},
  plugins: {},
};
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  registerListener: vi.fn().mockReturnValue(0),
  unregisterListener: vi.fn(),
};

// Mock Tauri invoke globally
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  transformCallback: vi.fn(),
}));

// Mock Tauri event API globally (used by dynamic import in useJobs)
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
