import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { ensureSquirrelSevenZipAlias } from './src/build/ensureSquirrelSevenZipAlias';
import { ResilientMakerSquirrel } from './src/build/ResilientMakerSquirrel';

const config: ForgeConfig = {
  hooks: {
    preMake: async () => {
      ensureSquirrelSevenZipAlias();
    },
  },
  packagerConfig: {
    // electron-packager appends the platform-appropriate extension
    // (.ico on Windows, .icns on macOS, .png on Linux) to this base path.
    icon: './assets/icon',
    asar: {
      // better-sqlite3's compiled .node binary cannot be dlopen'd from inside
      // an asar archive, so it must be unpacked alongside the archive.
      unpack: '**/node_modules/better-sqlite3/**/*',
    },
    // The Vite plugin's default packagerConfig.ignore only keeps the
    // '.vite' build output (everything else, including node_modules, is
    // excluded). better-sqlite3 is a native module that Vite/Rollup leaves
    // external (it cannot be bundled), so it must be explicitly let through
    // here or it is silently missing from the packaged app entirely.
    ignore: (file: string) => {
      if (!file) return false;
      const normalized = file.replace(/\\/g, '/');
      if (normalized.startsWith('/.vite')) return false;
      // Electron Packager's copy-filter skips descending into a directory
      // entirely if the directory itself is "ignored", so the top-level
      // node_modules folder (and the path leading down to better-sqlite3)
      // must be explicitly allowed through before filtering out everything
      // else under node_modules.
      if (normalized === '/node_modules') return false;
      if (normalized.startsWith('/node_modules/better-sqlite3')) return false;
      if (normalized.startsWith('/node_modules/')) return true;
      return true;
    },
  },
  // Native modules like better-sqlite3 ship prebuilt binaries (via
  // prebuildify) for the current platform/arch that already work without a
  // rebuild. Skip Forge's automatic electron-rebuild step (onlyModules: [])
  // since this environment has no Python/node-gyp toolchain available to
  // perform a rebuild, and it isn't needed here.
  rebuildConfig: { onlyModules: [] },
  makers: [
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
    // Squirrel.Windows installer (Setup.exe + .nupkg + RELEASES) is what
    // Electron's built-in autoUpdater (driven by src/main/updater.ts) expects
    // to find attached to a GitHub Release in order to check for and install
    // updates on Windows.
    new ResilientMakerSquirrel({
      authors: 'jm-parent',
      setupIcon: './assets/icon.ico',
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    // Belt-and-suspenders: ensures any *.node binary anywhere in the
    // packaged app is asar-unpacked, in case new native deps are added later.
    new AutoUnpackNativesPlugin({}),
  ],
};

export default config;
