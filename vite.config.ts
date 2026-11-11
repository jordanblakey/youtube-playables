import { defineConfig } from 'vite';

export default defineConfig({
  // YouTube Playables require relative asset paths so the bundle works in any hosted subpath
  base: './',
  server: {
    port: 8000,
    strictPort: false,
    cors: true,
  },
  preview: {
    port: 8000,
    strictPort: false,
    cors: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
