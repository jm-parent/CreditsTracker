import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // recharts' ResponsiveContainer needs ResizeObserver, which jsdom doesn't implement.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
