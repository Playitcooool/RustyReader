import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf("node_modules") === -1) return undefined;
          if (id.indexOf("pdfjs-dist") !== -1) return "pdfjs";
          if (id.indexOf("@tauri-apps") !== -1) return "tauri";
          if (id.indexOf("react") !== -1 || id.indexOf("scheduler") !== -1) return "react";
          return undefined;
        },
      },
    },
  },
});
