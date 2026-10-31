import { defineConfig } from 'vite';

// Relative base so the same build works locally and under the GitHub Pages subpath.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.js'],
  },
});
