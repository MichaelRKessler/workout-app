import { StartShortcut } from "@/components/StartShortcut";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Start",
};

export default function StartPage() {
  return (
    <Suspense fallback={<main className="px-5 pt-8 text-base text-muted">Opening your workout…</main>}>
      <StartShortcut />
    </Suspense>
  );
}
