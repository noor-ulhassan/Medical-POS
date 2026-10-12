import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// The renderer is built to static files and served by the app:// protocol
// (src/main/protocol.js). Electron 22 ships Chromium 108, hence the target.
export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': r('./src/shared') }
  },
  build: {
    outDir: r('./build/renderer'),
    emptyOutDir: true,
    target: 'chrome108',
    sourcemap: false,
    // src/shared/*.js are UMD modules also used by the main process.
    commonjsOptions: { include: [/src[\\/]shared[\\/]/, /node_modules/] }
  }
});
