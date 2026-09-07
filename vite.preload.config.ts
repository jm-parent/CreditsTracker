import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build/preload',
    lib: {
      entry: 'src/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
