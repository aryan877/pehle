import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The Rust API runs on :8787. In development Vite proxies API, webhook and media paths to it so the
// browser sees one origin, exactly like production behind Caddy.
const api = process.env.PEHLE_API ?? "http://127.0.0.1:8790";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/media": { target: api, changeOrigin: false },
      "/healthz": api,
      "/readyz": api,
    },
  },
  build: { target: "es2022", sourcemap: true },
});
