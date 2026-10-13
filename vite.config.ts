import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    // index.html: the 3D map (also embedded by the sites); site.html: a client's site (white label)
    rollupOptions: { input: { main: 'index.html', site: 'site.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
