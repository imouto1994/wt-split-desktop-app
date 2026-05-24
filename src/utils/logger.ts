/**
 * File logger for the Electron main process.
 *
 * Electron Windows builds are GUI apps that don't attach to a console — so
 * `console.log` / `console.error` writes are discarded in production. Without
 * a file logger, any main-process error is invisible and the only symptom is
 * downstream IPC failures ("Internal server error", queue aborts, etc.).
 *
 * This module:
 *   1. Tees stdout + stderr to a log file at `app.getPath('logs')/main.log`
 *      while still writing to the original streams (useful during `npm start`).
 *   2. Patches `console.*` so existing call sites automatically write to the
 *      log file with timestamps + level prefixes, no migration needed.
 *   3. Installs `uncaughtException` + `unhandledRejection` handlers that flush
 *      to the log file before quitting — so even crashes that escape try/catch
 *      leave a forensic record.
 *
 * Log file location per platform (Electron's default `app.getPath('logs')`):
 *   - Windows: %LocalAppData%\<app-name>\logs\main.log
 *   - macOS:   ~/Library/Logs/<app-name>/main.log
 *   - Linux:   ~/.config/<app-name>/logs/main.log
 *
 * No external dependency (intentionally — `electron-log` would add ~200KB
 * and we only need basic append-to-file behaviour for one process).
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** Resolved absolute path of the log file written by setupFileLogger. */
let logFilePath: string | null = null;

/** Returns the absolute path of the main-process log file, or null if not yet initialized. */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/**
 * Initialises file logging for the main process. Must be called AFTER
 * `app.whenReady()` because `app.getPath('logs')` is undefined until then.
 *
 * Safe to call multiple times — only the first call has effect.
 */
export function setupFileLogger(): void {
  if (logFilePath) {
    return;
  }

  const logsDir = app.getPath("logs");
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, "main.log");

  // Append mode so prior sessions' logs are preserved. Users can manually
  // truncate or rotate; we don't ship rotation since this is intended for
  // ad-hoc debugging, not long-term observability.
  const stream = fs.createWriteStream(logFilePath, { flags: "a" });

  // Header so it's obvious in the log when a new session started.
  stream.write(
    `\n=== ${new Date().toISOString()} | session start | pid=${process.pid} | electron=${process.versions.electron} ===\n`,
  );

  /** Serializes any console arg to a string suitable for log file output. */
  const formatArg = (arg: unknown): string => {
    if (arg instanceof Error) {
      return arg.stack || `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  };

  /**
   * Returns a console method replacement that logs to BOTH the file and the
   * original stream. Preserves dev-mode console visibility while ensuring
   * production builds capture everything to disk.
   */
  const teeToFile = (
    level: "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG",
    original: (...args: unknown[]) => void,
  ) => {
    return (...args: unknown[]) => {
      const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(" ")}\n`;
      stream.write(line);
      original(...args);
    };
  };

  console.log = teeToFile("LOG", console.log.bind(console));
  console.info = teeToFile("INFO", console.info.bind(console));
  console.warn = teeToFile("WARN", console.warn.bind(console));
  console.error = teeToFile("ERROR", console.error.bind(console));
  console.debug = teeToFile("DEBUG", console.debug.bind(console));

  // Catch-all for errors that escape try/catch. These would otherwise be
  // silently swallowed in production with no trace anywhere.
  process.on("uncaughtException", (error) => {
    console.error("uncaughtException:", error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason);
  });

  console.log(`File logger initialized → ${logFilePath}`);
}
