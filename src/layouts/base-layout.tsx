import type React from "react";
import DragWindowRegion from "@/components/drag-window-region";

export default function BaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DragWindowRegion title="Webtoon Stitch & Split" />
      <main className="h-screen overflow-auto p-4 pb-32">{children}</main>
    </>
  );
}
