import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vibe Calculators web app — Vite config.
// In dev, /api/* is proxied to the Express API at apps/api so the
// browser never has to know about CORS in development.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
