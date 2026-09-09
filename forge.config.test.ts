import { describe, expect, it, vi } from 'vitest';

const squirrelOptions: Array<Record<string, unknown>> = [];

vi.mock('@electron-forge/maker-squirrel', () => ({
  MakerSquirrel: class {
    constructor(options: Record<string, unknown>) {
      squirrelOptions.push(options);
    }
  },
}));

vi.mock('@electron-forge/maker-zip', () => ({ MakerZIP: class {} }));
vi.mock('@electron-forge/plugin-vite', () => ({ VitePlugin: class {} }));
vi.mock('@electron-forge/plugin-auto-unpack-natives', () => ({ AutoUnpackNativesPlugin: class {} }));

describe('Forge Squirrel configuration', () => {
  it('requests a desktop shortcut from Squirrel.Windows', async () => {
    await import('./forge.config');
    expect(squirrelOptions).toContainEqual(
      expect.objectContaining({ createDesktopShortcut: true }),
    );
  });
});
