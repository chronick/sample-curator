import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri invoke globally
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
