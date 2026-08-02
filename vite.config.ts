import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true
  }
});
