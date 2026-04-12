/**
 * Electron preload script — bridges the renderer to the main process.
 *
 * Two independent APIs are exposed:
 *   1. MessagePort bridge for oRPC (request/response IPC) — via window.addEventListener
 *   2. electronAPI via contextBridge — for push-style events like processing progress
 *
 * Context isolation is enabled, so contextBridge is required to safely expose
 * main-process events to the renderer's window object.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./constants";
import type { ProgressInfo } from "./constants";

// ── contextBridge API ─────────────────────────────────────────────────
// Push-style events from main → renderer that don't fit oRPC's
// request/response model.

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Subscribes to processing progress events pushed by the processWebtoon
   * handler during the stitch + split pipeline.
   * @returns A cleanup function that removes the listener.
   */
  onProcessingProgress: (callback: (info: ProgressInfo) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: ProgressInfo,
    ) => callback(info);
    ipcRenderer.on(IPC_CHANNELS.PROCESSING_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PROCESSING_PROGRESS, handler);
    };
  },
});

// ── oRPC MessagePort bridge ───────────────────────────────────────────
// Forwards a MessagePort from the renderer to the main process so the
// oRPC RPCHandler can communicate over it.

window.addEventListener("message", (event) => {
  if (event.data === IPC_CHANNELS.START_ORPC_SERVER) {
    const [serverPort] = event.ports;

    ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
  }
});
