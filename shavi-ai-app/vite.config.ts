import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Build goes straight into the site folder so GitHub Pages serves it at /shavi-ai/.
export default defineConfig({
  base: "/shavi-ai/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../shavi-ai"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
