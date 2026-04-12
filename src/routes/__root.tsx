/**
 * Root route — wraps every route with BaseLayout and (in dev) router devtools.
 *
 * Unlike wt-web-app, this project does NOT use @tanstack/devtools-vite, so
 * devtools are excluded from production manually via the lazy/no-op pattern
 * recommended by TanStack: https://tanstack.com/router/latest/docs/framework/react/devtools
 *
 * If @tanstack/devtools-vite is added to vite.renderer.config.mts in the
 * future, the lazy-loading guard here becomes redundant (the plugin auto-strips
 * devtools on build) and can be replaced with a plain static import.
 */
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { inDevelopment } from "@/constants";
import BaseLayout from "@/layouts/base-layout";

/**
 * In development: lazy-load the devtools so the module is code-split and only
 * fetched when the component first renders.
 * In production: render nothing — the devtools module is never imported, so the
 * bundler tree-shakes it out entirely.
 */
const TanStackRouterDevtools = inDevelopment
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )
  : () => null;

function Root() {
  // Starts visible in dev; Shift+D toggles it off when the floating
  // devtools button obscures content you're working on.
  const [showDevtools, setShowDevtools] = useState(inDevelopment);

  useEffect(() => {
    if (!inDevelopment) return;
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "D") setShowDevtools((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <BaseLayout>
      <Outlet />
      {/* Conditionally mount so the floating logo button is fully removed from
          the DOM when hidden, not just visually collapsed. */}
      {showDevtools && (
        <Suspense>
          <TanStackRouterDevtools />
        </Suspense>
      )}
    </BaseLayout>
  );
}

export const Route = createRootRoute({
  component: Root,
});
