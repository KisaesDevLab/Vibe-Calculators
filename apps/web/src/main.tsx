import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BASE_PATH } from "./lib/base-path";
import { App } from "./App";
import "./styles/globals.css";

// Appliance path-prefix support: when the SPA is served at /<slug>/*
// (Vibe-Appliance LAN/Tailscale modes), the runtime needs to direct
// `fetch("/api/...")` calls back through the slug prefix so they hit
// the appliance's per-app reverse proxy. We install a single
// pass-through fetch wrapper rather than rewriting ~100 call sites —
// it's narrowly scoped to string inputs that start with "/api/" and
// is a no-op when BASE_PATH is empty (standalone deploy).
if (BASE_PATH) {
  const original = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    if (typeof input === "string" && input.startsWith("/api/")) {
      return original(BASE_PATH + input, init);
    }
    if (input instanceof Request && input.url) {
      const u = new URL(input.url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) {
        const rebuilt = new Request(BASE_PATH + u.pathname + u.search + u.hash, input);
        return original(rebuilt, init);
      }
    }
    return original(input, init);
  };
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Vibe Calculators web: #root element not found in index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
