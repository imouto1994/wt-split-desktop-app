import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
// Note: @timfish/forge-externals-plugin is registered below by its package
// name string (not via constructor import) — Forge resolves and instantiates
// it via require() at runtime. This is the canonical usage documented in:
//   https://github.com/lovell/sharp/issues/4116
//   https://github.com/electron/forge/issues/4144
//   https://sharp.pixelplumbing.com/install#electron-forge
// The plugin copies "external" Vite/webpack dependencies and their full
// transitive trees into the packaged app's node_modules. Required because
// Forge's Vite plugin externalizes Sharp (correct — it's a native module
// that can't be bundled) but does NOT include it in the final asar. Without
// this plugin, the packaged app crashes at runtime with "Cannot find module
// 'sharp'".

const config: ForgeConfig = {
  packagerConfig: {
    // We use the OBJECT form of asar so we can specify which files must remain
    // outside the asar archive. Sharp's native binaries (.node, .dll, .so,
    // .dylib) cannot be loaded from inside an asar — they need to be on the
    // real filesystem so the OS dynamic linker can dlopen() them.
    //
    // The glob covers both `node_modules/sharp/` (Sharp's JS wrapper) and
    // `node_modules/@img/sharp-<platform>-<arch>/` (Sharp 0.33+ ships its
    // native binaries in platform-specific @img/* sub-packages). Unpacking
    // both keeps the loader's `require("@img/sharp-...")` resolution working.
    asar: {
      unpack: "**/node_modules/{sharp,@img}/**/*",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    {
      /*
       * Publish release on GitHub as draft.
       * Remember to manually publish it on GitHub website after verifying everything is correct.
       *
       * Both .github/workflows/publish.yaml runners (windows-latest, then macos-latest)
       * point this publisher at the same draft release. The macOS job is serialized
       * after the Windows job to avoid both runners simultaneously calling
       * getOrCreateDraftRelease and racing to POST /releases.
       */
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "imouto1994",
          name: "wt-split-desktop-app",
        },
        draft: true,
        prerelease: false,
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    // MUST come AFTER VitePlugin. The externals plugin runs at package time
    // and copies each listed package + its dependency tree from the project's
    // node_modules into the final app's node_modules, so the "external"
    // require() calls Vite leaves behind can be resolved at runtime.
    //
    // `includeDeps: true` recursively includes Sharp's full dependency tree
    // (notably the @img/sharp-<platform>-<arch> optional dependencies that
    // contain the prebuilt native binaries).
    //
    // Note: AutoUnpackNativesPlugin was removed — it scans the existing asar
    // for native modules and updates `asar.unpack`, but it can't help when
    // the module isn't in the asar to begin with. Our explicit asar.unpack
    // glob above does the unpacking, and this plugin does the inclusion.
    {
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["sharp"],
        includeDeps: true,
      },
    },

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // ASAR integrity validation requires the integrity hash to be embedded
      // in the signed binary. For unsigned builds (current CI flow), there
      // is no signature to embed the hash into, so these fuses are kept OFF.
      // Turn them ON once code signing is wired up (Apple Developer ID for
      // macOS, EV/OV code-signing cert for Windows).
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
