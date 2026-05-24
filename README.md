# electron-shadcn

Electron in all its glory. Everything you will need to develop your beautiful desktop application.

![Demo GIF](https://github.com/LuanRoger/electron-shadcn/blob/main/images/demo.png)

## Libs and tools

To develop a Electron app, you probably will need some UI, test, formatter, style or other kind of library or framework, so let me install and configure some of them to you.

### Core 🏍️

- [Electron 41](https://www.electronjs.org)
- [Vite 8](https://vitejs.dev)

### DX 🛠️

- [TypeScript 5.9](https://www.typescriptlang.org)
- [oRPC](https://orpc.unnoq.com)
- [Prettier](https://prettier.io)
- [Ultracite with Biome](https://www.ultracite.ai/providers/biome)
- [Zod 4](https://zod.dev)
- [React Query (TanStack)](https://react-query.tanstack.com)

### UI 🎨

- [React 19.2](https://reactjs.org)
- [Tailwind 4](https://tailwindcss.com)
- [Shadcn UI](https://ui.shadcn.com)
- [Geist](https://vercel.com/font) as default font
- [i18next](https://www.i18next.com)
- [TanStack Router](https://tanstack.com/router) (with file based routing)
- [Lucide](https://lucide.dev)

### Test 🧪

- [Vitest](https://vitest.dev)
- [Playwright](https://playwright.dev)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)

### Packing and distribution 📦

- [Electron Forge](https://www.electronforge.io)

### CI/CD 🚀

- Pre-configured [GitHub Actions workflow](https://github.com/LuanRoger/electron-shadcn/blob/main/.github/workflows/playwright.yml), for test with Playwright

### Project preferences 🎯

- Use Context isolation
- [React Compiler](https://react.dev/learn/react-compiler) is enabled by default.
- `titleBarStyle`: hidden (Using custom title bar)
- Geist as default font
- Some default styles was applied, check the [`styles`](https://github.com/LuanRoger/electron-shadcn/tree/main/src/styles) directory
- React DevTools are installed by default

## How to use

1. Clone this repository

```bash
git clone https://github.com/LuanRoger/electron-shadcn.git
```

Or use it as a template on GitHub

2. Install dependencies

```bash
npm install
```

3. Run the app

```bash
npm run start
```

Now you can go directly to `/src/routes/index.tsx` and modify the app as you want.

> You can also delete the `/src/routes/second.tsx` file if you don't want a second page.

## Downloading a build

Per-commit Windows and macOS (arm64 / Apple Silicon) builds are produced by the `Build` workflow on every push to `main` and stored as workflow artifacts for 30 days.

**To download:**

1. Go to the [Actions tab](https://github.com/imouto1994/wt-split-desktop-app/actions/workflows/build.yaml) of the repository.
2. Open the latest successful run of the `Build` workflow.
3. Scroll to the **Artifacts** section at the bottom of the run summary and download:
   - `windows-installer` — Squirrel `Setup.exe` + `.nupkg` + `RELEASES`
   - `macos-arm64-build` — `<name>-darwin-arm64-<version>.zip`

Tagged GitHub Releases (produced manually via the `Publish Release` workflow) contain the same installers — pick whichever is more convenient.

### Builds are unsigned — known warnings

These builds are **not code-signed and not notarized**. Users will see warnings on first launch.

#### Windows

When you run the `Setup.exe`, Microsoft Defender SmartScreen may block it with "Windows protected your PC".

- Click **More info**
- Click **Run anyway**

#### macOS (Apple Silicon)

After unzipping the build, macOS will quarantine the `.app` and refuse to launch it with a "damaged and can't be opened" or "cannot be verified" dialog.

**Option A — right-click bypass** (works on most macOS versions):

1. Drag `Webtoon Stitch & Split.app` into `/Applications`.
2. In Finder, **right-click** the app → **Open** → click **Open** in the warning dialog.
3. After this one-time approval, double-clicking works normally.

**Option B — strip quarantine attribute** (works on every macOS version including the strictest):

```bash
xattr -dr com.apple.quarantine "/Applications/Webtoon Stitch & Split.app"
```

Producing signed and notarized builds would require purchasing an Apple Developer ID certificate (~$99/year) and adding it as a GitHub Actions secret; tracked separately, not part of the current build pipeline.

## Troubleshooting

When the app fails in a production install, two places have the diagnostic info:

### 1. `main.log` (main-process logs)

All `console.log` / `console.error` output from the main process — including handler errors, uncaught exceptions, and unhandled promise rejections — is appended to a per-platform log file:

- **Windows**: `%LocalAppData%\wt_split_desktop_app\logs\main.log` (paste into File Explorer's address bar to open)
- **macOS**: `~/Library/Logs/Webtoon Stitch & Split/main.log`
- **Linux**: `~/.config/Webtoon Stitch & Split/logs/main.log`

Each session starts with a `=== <ISO timestamp> | session start | pid=... | electron=... ===` banner so you can find the relevant session quickly. When reporting a bug, paste the last ~50 lines starting from the most recent session banner.

### 2. DevTools (renderer-side logs)

The app ships with DevTools enabled in production builds. Open with `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS), or right-click anywhere → Inspect. Check the **Console** tab for renderer-side errors and the **Network** tab if a request looks suspicious.

### Common issues

| Symptom | Likely cause | Where to look |
|---|---|---|
| Status display shows `Error: ENOENT...` or similar | A file system path doesn't exist | Check the path in the input/output folder pickers |
| Status display shows `Error: Input image exceeds pixel limit` | Pixel-limit override missing on a new code path (the processor's standard helpers disable this limit, but a regression could re-introduce it) | File a bug — see `docs/APP.md` Processor section about `openSharp` / `createSharp` helpers |
| App opens but folder picker does nothing | Likely a Sharp / native module init failure — main process crashed at startup | Check `main.log` for an `Error during app initialization` entry near the most recent session banner |
| App crashes silently on launch | Catch-all fallback — main process died before the error dialog could fire | Run the `.exe` from `cmd` so any synchronous stderr output is visible, then check `main.log` |

## Auto update

> [!WARNING]
> This feature only work in open-source repositories in GitHub, if you need to use in a private repository, you need to setup a custom update server. Check the [Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates) section in the Electron documentation for more details.

The auto update uses GitHub Releases as source for the updates. The `publish` script will automatically create a new release with the version specified in your `package.json` file. You can run locally the `publish` script to create a new release, but you need to set the `GITHUB_TOKEN` environment variable with a GitHub Personal Access Token that has permission to create releases in your repository.

You can also use the GitHub Actions workflow to automatically create a new release when you push a new tag to the repository. The workflow need to be triggered manually, but you can modify to fit your needs. Also, the release is created as draft by default, so you can review and set a proper description before publish.

> Check the [`.github/workflows/publish.yml`](https://github.com/LuanRoger/electron-shadcn/blob/main/.github/workflows/publish.yaml) file for more details.

When you open the app, it will check for updates automatically. If an update is available, it will download and install the update, after that, it will restart the app to apply the update. This ensure  that your users always have the latest version of your app.

The auto update is implemented using [update-electron-app](https://github.com/electron/update-electron-app) to check the updates and apply them. For the publishing, it is using the [Electron Forge's GitHub publisher](https://www.electronforge.io/config/publishers/github).

## Documentation

Check out the full documentation [here](https://docs.luanroger.dev/electron-shadcn).

## Used by

- [yaste](https://github.com/LuanRoger/yaste) - yaste (Yet another super ₛᵢₘₚₗₑ text editor) is a text editor, that can be used as an alternative to the native text editor of your SO, maybe.
- [eletric-drizzle](https://github.com/LuanRoger/electric-drizzle) - shadcn-ui and Drizzle ORM with Electron.
- [Wordle Game](https://github.com/masonyekta/wordle-game) - A Wordle game which features interactive gameplay, cross-platform compatibility, and integration with a custom Wordle API for word validation and letter correctness.
- [Mehr 🌟](https://github.com/xmannii/MehrLocalChat) - A modern, elegant local AI chatbot application using Electron, React, shadcn/ui, and Ollama.

> Does you've used this template in your project? Add it here and open a PR.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/LuanRoger/electron-shadcn/blob/main/LICENSE) file for details.
