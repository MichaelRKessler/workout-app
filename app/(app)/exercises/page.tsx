import { ExerciseLibrary } from "@/components/ExerciseLibrary";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Exercises",
};

export default function ExercisesPage() {
  return (
    <Suspense fallback={<main className="px-5 pt-8 text-base text-muted">Loading exercises…</main>}>
      <ExerciseLibrary />
    </Suspense>
  );
}
