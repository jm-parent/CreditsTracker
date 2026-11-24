import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Rust build output (src-tauri/target, rust/target) must not be watched by the dev server.
  server: {
    watch: {
      ignored: ['**/src-tauri/**', '**/rust/target/**'],
    },
  },
});
