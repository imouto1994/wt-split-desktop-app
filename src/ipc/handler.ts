/**
 * oRPC handler wrapper for the message-port adapter.
 *
 * Wraps the top-level router in an RPCHandler instance configured with
 * error interceptors that:
 *
 *   1. Log every handler error (with full stack trace) via console.error,
 *      which the file logger in utils/logger.ts tees to main.log so
 *      production failures are forensically inspectable.
 *
 *   2. Replace oRPC's default sanitized "Internal server error" message sent
 *      to the renderer with the actual error message + cause. Without this,
 *      the React UI shows the user a useless generic string instead of the
 *      real cause (e.g., "ENOENT: no such file or directory", "Input image
 *      exceeds pixel limit", etc.).
 *
 * This is intentionally non-default behaviour: in a public-facing app you
 * don't want to leak internal error details to clients. For an internal /
 * personal Electron app the renderer IS the only client and surfacing the
 * real error message is critical for debugging.
 */
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { router } from "./router";

export const rpcHandler: RPCHandler<Record<never, never>> = new RPCHandler(
  router,
  {
    // Top-level interceptors observe errors AFTER the procedure has run and
    // BEFORE the response is encoded. We log here so the full Error object
    // (with stack + cause) is preserved in the log file.
    interceptors: [
      onError((error) => {
        console.error("[oRPC handler error]", error);
      }),
    ],
    // clientInterceptors fire at the Server-Side Procedure Client layer,
    // which is where INTERNAL_SERVER_ERROR is normally produced from
    // uncaught exceptions. We catch that here, extract the real message
    // from the `cause`, and re-throw a new ORPCError carrying it. The
    // renderer then sees the actual message instead of the sanitized one.
    clientInterceptors: [
      onError((error) => {
        if (
          error instanceof ORPCError &&
          error.code === "INTERNAL_SERVER_ERROR"
        ) {
          const cause = error.cause;
          const realMessage =
            cause instanceof Error
              ? cause.message
              : typeof cause === "string"
                ? cause
                : "Unknown handler error (see main.log)";
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: realMessage,
            cause,
          });
        }
      }),
    ],
  },
);
