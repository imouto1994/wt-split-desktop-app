/**
 * Vite config for the Electron main process bundle.
 *
 * Sharp is externalized because it's a native module (C++ addon) that
 * Vite/Rollup cannot bundle. Sharp 0.33+ also depends on platform-specific
 * `@img/sharp-<platform>-<arch>` packages that ship the prebuilt .node
 * binaries; those are dynamically required by Sharp at runtime, so they
 * MUST be externalized too. Without the @img/* externalization, Rollup
 * would try to follow the dynamic import and fail (or worse, bundle the
 * wrong platform's binary).
 *
 * Both `sharp` and the `@img/*` packages are then copied into the packaged
 * app's node_modules at make time by @timfish/forge-externals-plugin
 * (configured in forge.config.ts), and unpacked from the asar at install
 * time so the OS dynamic linker can load the .node binaries.
 */
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: ["sharp", /^@img\//],
    },
  },
});
