import { defineConfig } from 'vite';

// Relative base so the same build works locally and under the GitHub Pages subpath.
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 900, // three alone is ~830 kB minified (~240 kB gzip)
    rolldownOptions: {
      output: {
        // three changes far less often than the app, so it gets its own long-cached chunk.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
