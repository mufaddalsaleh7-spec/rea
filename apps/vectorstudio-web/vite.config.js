import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite dev server proxies /api to the PHP backend so the browser only ever sees
 * one origin (no CORS, no localhost calls from the browser in production).
 *
 *   npm run dev          # React on 5173, proxying to PHP on 8080
 *   npm run build        # bundle into dist/, which PHP serves directly
 */
export default defineConfig({
  // Relative base keeps the bundle portable: GitHub Pages serves the app from
  // /<repo>/, PHP serves it from /, and file:// still resolves the chunks.
  base: process.env.VITE_BASE || "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT || 5173),
    strictPort: false,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_PHP_ORIGIN || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
