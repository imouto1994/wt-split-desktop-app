/**
 * Electron main process entry point.
 *
 * Responsibilities:
 *   1. Register the local-file:// custom protocol (must happen before app.ready)
 *   2. Create the BrowserWindow with appropriate size and security settings
 *   3. Register the protocol handler for serving local image files
 *   4. Bootstrap the oRPC server for renderer-to-main IPC
 *   5. Install dev tools and set up auto-updates
 */
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, protocol } from "electron";
import { ipcMain } from "electron/main";
import {
  installExtension,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { ipcContext } from "@/ipc/context";
import { IPC_CHANNELS, inDevelopment } from "./constants";
import { getBasePath } from "./utils/path";

// Register the custom scheme BEFORE app.ready — this is a Chromium requirement.
// The scheme needs to be "standard" so URLs are parsed with authority/path
// components, and "secure" so the renderer trusts it for fetch/img/etc.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.js");
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      devTools: inDevelopment,
      contextIsolation: true,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,

      preload,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 5, y: 5 } : undefined,
  });
  // Store the window reference so oRPC handlers can access it
  // (e.g., dialog handlers need the parent window for modal sheets).
  ipcContext.setMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

async function installExtensions() {
  try {
    const result = await installExtension(REACT_DEVELOPER_TOOLS);
    console.log(`Extensions installed successfully: ${result.name}`);
  } catch {
    console.error("Failed to install extensions");
  }
}

function checkForUpdates() {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: "LuanRoger/electron-shadcn",
    },
  });
}

/**
 * Sets up the oRPC server that handles all renderer-to-main communication.
 *
 * The renderer creates a MessageChannel, sends one port via window.postMessage,
 * which the preload forwards to the main process. We receive that port here
 * and hand it to the RPCHandler so oRPC can communicate over it.
 */
async function setupORPC() {
  const { rpcHandler } = await import("./ipc/handler");

  ipcMain.on(IPC_CHANNELS.START_ORPC_SERVER, (event) => {
    const [serverPort] = event.ports;

    serverPort.start();
    rpcHandler.upgrade(serverPort);
  });
}

app.whenReady().then(async () => {
  try {
    // MIME types for the local-file:// protocol handler.
    const MIME_TYPES: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };

    // Register the protocol handler for local-file:// URLs.
    //
    // Why not net.fetch("file://...")? Because net.fetch was returning
    // ERR_FILE_NOT_FOUND in some cases. Reading directly with fs.readFile
    // is more reliable and avoids the intermediate file:// URL layer.
    //
    // URL format: local-file://localhost/absolute/path/to/file.png
    // The "localhost" host is required because registering as a "standard"
    // scheme causes Chromium to parse the first path component after ://
    // as the hostname. Without it, "/Users/foo" would have "Users" eaten
    // as the host, producing a truncated pathname.
    protocol.handle("local-file", async (request) => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname);
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        },
      });
    });

    createWindow();
    await installExtensions();
    checkForUpdates();
    await setupORPC();
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// On macOS, re-create the window when the dock icon is clicked and no
// windows are open (standard macOS app behavior).
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
