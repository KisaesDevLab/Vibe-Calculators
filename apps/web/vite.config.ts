import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vibe Calculators web app — Vite config.
// In dev, /api/* is proxied to the Express API at apps/api so the
// browser never has to know about CORS in development.
//
// Production builds bake in a sentinel base path so a single image can
// serve either '/' (single-app standalone deploys) or '/<prefix>/'
// (multi-app behind the Vibe-Appliance shared Caddy with path-prefix
// routing in LAN / Tailscale modes). apps/web/docker/web-entrypoint.sh
// substitutes /__VIBE_BASE_PATH__/ with $VITE_BASE_PATH across the
// built assets at container start. Same pattern as sibling apps —
// see Vibe-Trial-Balance/deploy/web-entrypoint.sh and Vibe-Appliance
// lib/enable-app.sh (lines 683-687) for the contract.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/__VIBE_BASE_PATH__/" : "/",
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
}));
