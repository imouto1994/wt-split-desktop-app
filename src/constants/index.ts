export const LOCAL_STORAGE_KEYS = {
  LANGUAGE: "lang",
  THEME: "theme",
};

export const IPC_CHANNELS = {
  START_ORPC_SERVER: "start-orpc-server",
  /** Push channel for stage-aware processing progress from main → renderer. */
  PROCESSING_PROGRESS: "processing-progress",
};

/**
 * Processing pipeline stage names used by the onProgress callback.
 * Shared across main (processor), preload (contextBridge), and renderer.
 */
export type ProgressStage =
  | "stitching"
  | "analyzing"
  | "writing"
  | "finalizing";

/**
 * Progress update payload sent from the processor → handler → renderer
 * during the processWebtoon pipeline via Electron IPC events.
 */
export interface ProgressInfo {
  stage: ProgressStage;
  /** 1-based index of the current segment being written (only for "writing" stage). */
  current?: number;
  /** Total number of segments to write (only for "writing" stage). */
  total?: number;
  /** Extra context string, e.g. filename or image count. */
  detail?: string;
}

export const ENVIRONMENT_VARIABLES = {
  NODE_ENV: process.env.NODE_ENV,
};

export const inDevelopment = ENVIRONMENT_VARIABLES.NODE_ENV === "development";

/**
 * Default processing parameters for the gap-detection pipeline.
 * Shared between processor.ts (main process) and the renderer UI
 * so both use the same defaults and the UI can display/reset them.
 *
 * MIN_GAP_HEIGHT was lowered from 100 → 50 because the cross-row
 * consistency check in findUniformRowRuns now excludes border rows from
 * gap runs (shrinking detected gaps) and 50px catches more real panel gaps.
 *
 * COLOR_TOLERANCE was raised from 10 → 20 to handle compression artifacts
 * in real comic images. The cross-row consistency check makes higher
 * tolerance safe by preventing color drift and border absorption.
 */
export const DEFAULT_MIN_GAP_HEIGHT = 50;
export const DEFAULT_COLOR_TOLERANCE = 20;
