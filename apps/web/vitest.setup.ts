import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock matchMedia for components that rely on it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
});

// Basic clipboard mock used by registration UI
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
});

if (!('createObjectURL' in URL)) {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn()
  });
}
