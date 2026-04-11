export const LOCAL_STORAGE_KEYS = {
  LANGUAGE: "lang",
  THEME: "theme",
};

export const IPC_CHANNELS = {
  START_ORPC_SERVER: "start-orpc-server",
};

export const ENVIRONMENT_VARIABLES = {
  NODE_ENV: process.env.NODE_ENV,
};

export const inDevelopment = ENVIRONMENT_VARIABLES.NODE_ENV === "development";

/**
 * Default processing parameters for the gap-detection pipeline.
 * Shared between processor.ts (main process) and the renderer UI
 * so both use the same defaults and the UI can display/reset them.
 */
export const DEFAULT_MIN_GAP_HEIGHT = 100;
export const DEFAULT_COLOR_TOLERANCE = 10;
