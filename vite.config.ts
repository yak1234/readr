import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// React Fast Refresh injects a small inline script in development only,
// so the dev server relaxes script-src; the packaged app keeps 'self'.
function devCsp(): Plugin {
  return {
    name: "readr-dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  };
}

export default defineConfig({
  plugins: [react(), devCsp()],
  base: "./", // loaded from file:// when packaged
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
